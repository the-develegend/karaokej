import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { stat } from 'node:fs/promises';
import { access, constants } from 'node:fs/promises';
import { TrackDto } from '@karaokej/shared';
import { AppConfigService } from '../config/app-config.service';
import { DbService } from '../db/db.service';
import type { TrackRow } from '../db/types';
import { pruneOrphanedCoverGroups } from '../covers/cover-storage';
import { lyricPathFor } from '../library/fs-utils';
import { readTrackMetadata } from '../library/scan-metadata';
import { resolveReliableDurationMs } from '../library/probe-duration';
import { upsertTagsTrack } from '../library/scan-track-upsert';
import { LibraryService } from '../library/library.service';
import { SessionService } from '../session/session.service';
import {
  editableFromParsed,
  metadataEquals,
  normalizeEditableMetadata,
  type TrackMetadataFileDto,
} from './metadata-fields';
import { writeMetadataToFile } from './metadata-tags';
import {
  describeMetadataStoreError,
  metadataStoreError,
} from './metadata-store-error';

@Injectable()
export class TrackMetadataService {
  private readonly logger = new Logger(TrackMetadataService.name);

  constructor(
    private readonly db: DbService,
    private readonly config: AppConfigService,
    private readonly library: LibraryService,
    private readonly session: SessionService,
  ) {}

  private async probeDuration(
    absolute: string,
    relativePath: string,
  ): Promise<number | null> {
    return resolveReliableDurationMs(absolute, {
      ffprobePath: this.config.ffprobePath,
      fsTimeoutMs: this.config.scanFsTimeoutMs,
      relativePath,
    });
  }

  async readFromFile(trackId: number): Promise<TrackMetadataFileDto> {
    const track = this.library.getTrack(trackId);
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    const absolute = this.config.resolveUnderLibrary(track.relative_path);
    if (!absolute) {
      throw new BadRequestException('Track path is outside the music library');
    }

    const result = await readTrackMetadata(absolute, track.relative_path, {
      fsTimeoutMs: this.config.scanFsTimeoutMs,
    });
    const durationMs = await this.probeDuration(absolute, track.relative_path);
    const editable = editableFromParsed(result.metadata);
    return {
      ...editable,
      durationMs,
      format: track.format,
    };
  }

  async updateMetadata(
    trackId: number,
    body: Record<string, unknown>,
  ): Promise<TrackDto> {
    const track = this.library.getTrack(trackId);
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    const absolute = this.config.resolveUnderLibrary(track.relative_path);
    if (!absolute) {
      throw new BadRequestException('Track path is outside the music library');
    }

    const desired = normalizeEditableMetadata(body);
    if (!desired.title) {
      throw new BadRequestException('title is required');
    }

    try {
      return await this.writeMetadata(trackId, track, absolute, desired);
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error(
        `Could not store metadata for track ${trackId}: ${describeMetadataStoreError(err)}`,
        err instanceof Error ? err.stack : undefined,
      );
      throw metadataStoreError(err);
    }
  }

  private async writeMetadata(
    trackId: number,
    track: TrackRow,
    absolute: string,
    desired: ReturnType<typeof normalizeEditableMetadata>,
  ): Promise<TrackDto> {
    const fileRead = await readTrackMetadata(absolute, track.relative_path, {
      fsTimeoutMs: this.config.scanFsTimeoutMs,
    });
    const current = editableFromParsed(fileRead.metadata);
    const fileChanged = !metadataEquals(current, desired);

    if (fileChanged) {
      await writeMetadataToFile(absolute, track.format, desired);
    }

    const info = await stat(absolute);
    let hasLrc = false;
    try {
      await access(lyricPathFor(absolute), constants.F_OK);
      hasLrc = true;
    } catch {
      hasLrc = false;
    }

    const durationMs = await this.probeDuration(absolute, track.relative_path);
    const parsed = {
      ...fileRead.metadata,
      title: desired.title,
      artist: desired.artist,
      album: desired.album,
      albumArtist: desired.albumArtist,
      trackNo: desired.trackNo,
      year: desired.year,
      genres: desired.genres,
      rating: desired.rating,
      musicbrainzArtistId: desired.musicbrainzArtistId,
      musicbrainzRecordingId: desired.musicbrainzRecordingId,
      musicbrainzReleaseId: desired.musicbrainzReleaseId,
      isrc: desired.isrc,
      durationMs,
    };

    const now = Date.now();
    const previousCoverGroup = track.cover_group ?? null;
    upsertTagsTrack(
      this.db.raw,
      {
        relativePath: track.relative_path,
        format: track.format,
        sizeBytes: info.size,
        mtimeMs: Math.floor(info.mtimeMs),
        hasLrc,
      },
      parsed,
      now,
    );

    if (previousCoverGroup) {
      pruneOrphanedCoverGroups(this.db.raw, this.config.coverCachePath, [
        previousCoverGroup,
      ]);
    }

    this.session.broadcast();
    const updated = this.library.getTrackDto(trackId);
    if (!updated) {
      throw new NotFoundException('Track not found');
    }
    return updated;
  }
}
