import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  TrackDto,
  YoutubeSearchHitDto,
  YoutubeSearchResultDto,
} from '@karaokej/shared';
import { AppConfigService } from '../config/app-config.service';
import { LibraryService } from '../library/library.service';
import {
  buildYoutubeDownloadArgs,
  buildYoutubeSearchArgs,
  spawnCollect,
} from './ytdlp-cli';
import { assertYoutubeVideoId } from './ytdlp-path-utils';
import {
  cleanYoutubeDownloadBasename,
  resolveUniqueDownloadBasename,
} from './youtube-download-name';

interface YtdlpFlatEntry {
  id?: string;
  title?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
}

@Injectable()
export class YtdlpService {
  private readonly logger = new Logger(YtdlpService.name);
  private downloadRunning = false;

  constructor(
    private readonly config: AppConfigService,
    private readonly library: LibraryService,
  ) {}

  isAvailable(): boolean {
    return existsSync(this.config.ytdlpPath);
  }

  async search(query: string): Promise<YoutubeSearchResultDto> {
    const trimmed = query.trim();
    if (!trimmed) {
      throw new BadRequestException('Search query is required');
    }
    this.ensureAvailable();
    const args = buildYoutubeSearchArgs(
      trimmed,
      this.config.ytdlpPath,
      this.config.ytdlpNodePath,
    );
    const { stdout, stderr, code } = await spawnCollect(
      this.config.ytdlpPath,
      args,
      60_000,
    );
    if (code !== 0) {
      this.logger.warn(`yt-dlp search failed (${code}): ${stderr.slice(0, 500)}`);
      throw new BadRequestException('YouTube search failed');
    }
    const hits = this.parseSearchHits(stdout);
    return { query: trimmed, hits };
  }

  async download(videoId: string): Promise<TrackDto> {
    if (this.downloadRunning) {
      throw new ConflictException('A download is already in progress');
    }
    this.ensureAvailable();
    let id: string;
    try {
      id = assertYoutubeVideoId(videoId);
    } catch {
      throw new BadRequestException('Invalid YouTube video ID');
    }
    const downloadsDir = this.downloadsDirectory();
    mkdirSync(downloadsDir, { recursive: true });

    this.downloadRunning = true;
    this.library.setJob('download', {
      running: true,
      current: 0,
      total: 1,
      message: 'Downloading from YouTube…',
    });

    try {
      const args = buildYoutubeDownloadArgs(
        this.config.ytdlpPath,
        this.config.ytdlpFfmpegPath,
        downloadsDir,
        id,
        this.config.ytdlpAudioFormat,
        this.config.ytdlpNodePath,
      );
      const { stderr, code } = await spawnCollect(
        this.config.ytdlpPath,
        args,
        600_000,
      );
      if (code !== 0) {
        this.logger.warn(`yt-dlp download failed (${code}): ${stderr.slice(0, 500)}`);
        throw new BadRequestException('YouTube download failed');
      }

      this.library.setJob('download', {
        running: true,
        message: 'Indexing downloaded file…',
      });

      let absolutePath = this.findDownloadedFile(downloadsDir, id);
      if (!absolutePath) {
        throw new BadRequestException('Downloaded file was not found on disk');
      }

      absolutePath = this.renameDownloadToCleanName(downloadsDir, absolutePath);

      const track = await this.library.ingestDownloadedFile(absolutePath);
      this.library.setJob('download', {
        running: false,
        current: 1,
        total: 1,
        message: `Downloaded ${track.title}`,
      });
      return track;
    } catch (err) {
      this.library.setJob('download', {
        running: false,
        message:
          err instanceof Error ? err.message : 'YouTube download failed',
      });
      throw err;
    } finally {
      this.downloadRunning = false;
    }
  }

  private ensureAvailable(): void {
    if (!existsSync(this.config.ytdlpPath)) {
      throw new ServiceUnavailableException(
        'yt-dlp is not installed at the configured path',
      );
    }
  }

  private downloadsDirectory(): string {
    const firstRoot = this.library.requireLibraryRootsForDownload();
    return join(firstRoot, 'Downloads');
  }

  private parseSearchHits(stdout: string): YoutubeSearchHitDto[] {
    const hits: YoutubeSearchHitDto[] = [];
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const entry = JSON.parse(trimmed) as YtdlpFlatEntry;
        if (!entry.id) {
          continue;
        }
        hits.push({
          id: entry.id,
          title: entry.title?.trim() || entry.id,
          uploader: entry.uploader?.trim() || entry.channel?.trim() || null,
          durationMs:
            entry.duration != null && entry.duration > 0
              ? Math.round(entry.duration * 1000)
              : null,
        });
      } catch {
        /* skip malformed line */
      }
    }
    return hits.slice(0, 5);
  }

  private renameDownloadToCleanName(
    downloadsDir: string,
    absolutePath: string,
  ): string {
    const originalBasename = basename(absolutePath);
    const cleanedBasename = cleanYoutubeDownloadBasename(originalBasename);
    if (cleanedBasename === originalBasename) {
      return absolutePath;
    }
    const uniqueBasename = resolveUniqueDownloadBasename(
      downloadsDir,
      cleanedBasename,
      originalBasename,
    );
    const nextPath = join(downloadsDir, uniqueBasename);
    renameSync(absolutePath, nextPath);
    return nextPath;
  }

  private findDownloadedFile(downloadsDir: string, videoId: string): string | null {
    const suffix = `[${videoId}].${this.config.ytdlpAudioFormat}`;
    const files = readdirSync(downloadsDir);
    const match = files.find((name) => name.endsWith(suffix));
    if (match) {
      return join(downloadsDir, match);
    }
    const mp3s = files
      .filter((name) => name.endsWith(`.${this.config.ytdlpAudioFormat}`))
      .map((name) => ({
        name,
        mtime: statSync(join(downloadsDir, name)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);
    return mp3s[0] ? join(downloadsDir, mp3s[0].name) : null;
  }
}
