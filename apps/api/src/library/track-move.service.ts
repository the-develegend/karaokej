import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  copyFile,
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { TrackDto, TrackMovePreviewDto } from '@karaokej/shared';
import { AppConfigService } from '../config/app-config.service';
import { DbService } from '../db/db.service';
import { trackToDto } from '../db/types';
import { isCoverImageFile } from '../covers/cover-source';
import { loadCoverInfoForTrack } from '../covers/cover-lookup';
import { SettingsService } from '../settings/settings.service';
import { SessionService } from '../session/session.service';
import { lyricPathFor } from './fs-utils';
import { nestingRelative } from './scan-root';
import { prefixCataloguePath } from './library-paths';
import {
  buildLibraryRelativePath,
  validateLibraryLayoutMetadata,
  withConflictSuffix,
} from './library-path-layout';
import { LibraryService } from './library.service';

@Injectable()
export class TrackMoveService {
  constructor(
    private readonly library: LibraryService,
    private readonly config: AppConfigService,
    private readonly settings: SettingsService,
    private readonly db: DbService,
    private readonly session: SessionService,
  ) {}

  async previewMove(trackId: number): Promise<TrackMovePreviewDto> {
    const plan = this.planMove(trackId);
    return {
      fromAbsolute: plan.fromAbsolute,
      toAbsolute: plan.targetAbsolute,
      conflict: plan.conflict,
      sidecars: plan.sidecarPaths,
    };
  }

  async executeMove(
    trackId: number,
    removeEmptyDirs: boolean,
  ): Promise<TrackDto> {
    const track = this.library.getTrack(trackId);
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    const plan = this.planMove(trackId);

    const cataloguePath = this.cataloguePathForAbsolute(
      plan.targetAbsolute,
      plan.mainRoot,
    );
    if (!cataloguePath) {
      throw new BadRequestException('Cannot resolve catalogue path for target');
    }

    const conflictRow = this.db.raw
      .prepare(
        `SELECT id FROM tracks WHERE relative_path = ? AND id != ? LIMIT 1`,
      )
      .get(cataloguePath, trackId) as { id: number } | undefined;
    if (conflictRow) {
      throw new ConflictException(
        'Another track already uses the destination catalogue path',
      );
    }

    const oldAbsolute = plan.fromAbsolute;
    const newAbsolute = plan.targetAbsolute;

    await mkdir(dirname(newAbsolute), { recursive: true });
    await this.moveFile(oldAbsolute, newAbsolute);

    const sidecarMoves = this.planSidecarMoves(
      plan.sidecarPaths,
      oldAbsolute,
      newAbsolute,
    );
    for (const { from, to } of sidecarMoves) {
      await mkdir(dirname(to), { recursive: true });
      await this.moveFile(from, to);
    }

    if (removeEmptyDirs) {
      await this.removeEmptyParents(
        dirname(oldAbsolute),
        this.config.libraryLayout.roots,
      );
    }

    const fileStat = await stat(newAbsolute);
    const now = Date.now();
    this.db.raw
      .prepare(
        `UPDATE tracks SET relative_path = ?, mtime_ms = ?, size_bytes = ?, updated_at = ? WHERE id = ?`,
      )
      .run(cataloguePath, fileStat.mtimeMs, fileStat.size, now, trackId);

    const updated = this.library.getTrack(trackId);
    if (!updated) {
      throw new NotFoundException('Track not found');
    }
    this.session.broadcast();
    return trackToDto(
      updated,
      null,
      loadCoverInfoForTrack(this.db.raw, updated),
    );
  }

  private planMove(trackId: number): {
    fromAbsolute: string;
    canonicalAbsolute: string;
    targetAbsolute: string;
    conflict: boolean;
    sidecarPaths: string[];
    mainRoot: string;
  } {
    const track = this.library.getTrack(trackId);
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    const fromAbsolute = this.config.resolveUnderLibrary(track.relative_path);
    if (!fromAbsolute || !existsSync(fromAbsolute)) {
      throw new BadRequestException('Track file is unavailable');
    }

    const mainRoot = this.resolveMainRootAbsolute();
    const mainConfigured = this.settings.getEffectiveMainLibraryPath() != null;
    const metadata = {
      title: track.title,
      artist: track.artist,
      albumArtist: track.album_artist,
      album: track.album,
      year: track.year,
      trackNo: track.track_no,
      fileExtension: extname(fromAbsolute).toLowerCase() || `.${track.format}`,
    };
    const validationErrors = validateLibraryLayoutMetadata(
      metadata,
      mainConfigured,
    );
    if (validationErrors.length > 0) {
      throw new BadRequestException(
        validationErrors.map((e) => e.message).join('; '),
      );
    }

    const relativePath = buildLibraryRelativePath(metadata);
    if (!relativePath) {
      throw new BadRequestException('Cannot build destination path');
    }

    const canonicalAbsolute = join(mainRoot, ...relativePath.split('/'));
    const targetAbsolute = this.resolveAvailablePath(canonicalAbsolute);
    const conflict = targetAbsolute !== canonicalAbsolute;

    return {
      fromAbsolute,
      canonicalAbsolute,
      targetAbsolute,
      conflict,
      sidecarPaths: listStemSidecarPaths(fromAbsolute),
      mainRoot,
    };
  }

  private resolveMainRootAbsolute(): string {
    const paths = this.settings.getLibraryPaths();
    const main = this.settings.getEffectiveMainLibraryPath();
    if (!main) {
      throw new BadRequestException('No main library folder configured');
    }
    const index = paths.indexOf(main);
    if (index < 0) {
      throw new BadRequestException('Main library folder is not configured');
    }
    const layout = this.config.libraryLayout;
    const root = layout.roots[index];
    if (!root) {
      throw new BadRequestException('Main library folder is unavailable');
    }
    return root;
  }

  private cataloguePathForAbsolute(
    absolute: string,
    mainRoot: string,
  ): string | null {
    const relativeUnderRoot = relative(mainRoot, absolute).replace(/\\/g, '/');
    const layout = this.config.libraryLayout;
    const key = layout.keys.get(mainRoot);
    if (!key) {
      return null;
    }
    return prefixCataloguePath(key, relativeUnderRoot, layout.multiRoot);
  }

  private resolveAvailablePath(canonical: string): string {
    if (!existsSync(canonical)) {
      return canonical;
    }
    let suffix = 2;
    for (;;) {
      const candidate = withConflictSuffix(canonical, suffix);
      if (!existsSync(candidate)) {
        return candidate;
      }
      suffix += 1;
      if (suffix > 500) {
        throw new ConflictException('Too many conflicting files at destination');
      }
    }
  }

  private planSidecarMoves(
    sidecars: string[],
    oldAudio: string,
    newAudio: string,
  ): Array<{ from: string; to: string }> {
    const moves: Array<{ from: string; to: string }> = [];
    const newDir = dirname(newAudio);
    const newStem = basename(newAudio, extname(newAudio));
    const oldStem = basename(oldAudio, extname(oldAudio));

    for (const sidecar of sidecars) {
      if (sidecar.endsWith('.lrc')) {
        moves.push({ from: sidecar, to: lyricPathFor(newAudio) });
        continue;
      }
      const sidecarStem = basename(sidecar, extname(sidecar));
      if (sidecarStem === oldStem) {
        moves.push({
          from: sidecar,
          to: join(newDir, `${newStem}${extname(sidecar)}`),
        });
      } else {
        moves.push({ from: sidecar, to: join(newDir, basename(sidecar)) });
      }
    }
    return moves;
  }

  private async moveFile(from: string, to: string): Promise<void> {
    if (from === to) {
      return;
    }
    try {
      await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EXDEV') {
        throw err;
      }
      await copyFile(from, to);
      await unlink(from);
    }
  }

  private async removeEmptyParents(
    startDir: string,
    stopRoots: string[],
  ): Promise<void> {
    let current = startDir;
    for (;;) {
      const underSomeRoot = stopRoots.some(
        (root) => nestingRelative(root, current) !== null,
      );
      if (!underSomeRoot) {
        break;
      }
      const isRoot = stopRoots.some(
        (root) => root.replace(/\\/g, '/') === current.replace(/\\/g, '/'),
      );
      if (isRoot) {
        break;
      }
      let entries: string[];
      try {
        entries = await readdir(current);
      } catch {
        break;
      }
      if (entries.length > 0) {
        break;
      }
      const parent = dirname(current);
      try {
        await rm(current, { recursive: false });
      } catch {
        break;
      }
      current = parent;
    }
  }
}

export function listStemSidecarPaths(audioAbsolute: string): string[] {
  const directory = dirname(audioAbsolute);
  const base = basename(audioAbsolute);
  const audioExt = extname(base);
  const stem = base.slice(0, base.length - audioExt.length);

  const paths: string[] = [];
  const lrc = lyricPathFor(audioAbsolute);
  if (existsSync(lrc)) {
    paths.push(lrc);
  }

  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return paths;
  }

  for (const name of entries) {
    if (!isCoverImageFile(name)) {
      continue;
    }
    const imageStem = basename(name, extname(name));
    if (imageStem === stem) {
      paths.push(join(directory, name));
    }
  }
  return paths;
}
