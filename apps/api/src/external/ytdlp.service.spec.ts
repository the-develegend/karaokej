import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { existsSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { YtdlpService } from './ytdlp.service';
import * as ytdlpCli from './ytdlp-cli';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(),
    renameSync: vi.fn(),
    statSync: vi.fn(),
  };
});

describe('YtdlpService', () => {
  let service: YtdlpService;
  const library = {
    setJob: vi.fn(),
    ingestDownloadedFile: vi.fn(),
    requireLibraryRootsForDownload: vi.fn(() => '/mnt/a/Music'),
  };
  const config = {
    ytdlpPath: '/mnt/c/Program Files/yt-dlp/yt-dlp.exe',
    ytdlpFfmpegPath: '/code/karaokej/vendor/win/bin/ffmpeg.exe',
    ytdlpAudioFormat: 'mp3',
    ytdlpNodePath: '/mnt/c/Program Files/nodejs/node.exe',
    libraryPaths: ['/mnt/a/Music'],
  };

  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.spyOn(ytdlpCli, 'spawnCollect').mockReset();
    library.setJob.mockReset();
    library.ingestDownloadedFile.mockReset();
    service = new YtdlpService(config as never, library as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when yt-dlp is missing', async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    await expect(service.search('hello')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('parses search hits from yt-dlp JSON lines', async () => {
    vi.spyOn(ytdlpCli, 'spawnCollect').mockResolvedValue({
      stdout: [
        JSON.stringify({
          id: 'abc12345678',
          title: 'Song',
          uploader: 'Artist',
          duration: 210,
        }),
      ].join('\n'),
      stderr: '',
      code: 0,
    });
    const result = await service.search('hello');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).toMatchObject({
      id: 'abc12345678',
      title: 'Song',
      uploader: 'Artist',
      durationMs: 210_000,
    });
    expect(ytdlpCli.spawnCollect).toHaveBeenCalledWith(
      config.ytdlpPath,
      expect.arrayContaining(['ytsearch5:hello']),
      60_000,
    );
  });

  it('rejects concurrent downloads', async () => {
    vi.spyOn(ytdlpCli, 'spawnCollect').mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    const first = service.download('dQw4w9WgXcQ');
    await expect(service.download('dQw4w9WgXcQ')).rejects.toThrow(
      ConflictException,
    );
    void first;
  });

  it('rejects invalid video IDs', async () => {
    await expect(service.download('bad')).rejects.toThrow(BadRequestException);
  });

  it('renames downloaded file before indexing', async () => {
    const downloadsDir = '/mnt/a/Music/Downloads';
    const rawName = 'Rihanna_-_Umbrella_Lyrics_ft._JAY-Z [EPtrQpx9VDw].mp3';
    const cleanedName = 'Rihanna - Umbrella ft. JAY-Z.mp3';

    vi.spyOn(ytdlpCli, 'spawnCollect').mockResolvedValue({
      stdout: '',
      stderr: '',
      code: 0,
    });
    vi.mocked(readdirSync).mockReturnValue([rawName] as never);
    vi.mocked(renameSync).mockImplementation(() => undefined);
    vi.mocked(existsSync).mockImplementation((path) =>
      String(path).includes('yt-dlp'),
    );
    library.ingestDownloadedFile.mockResolvedValue({
      title: 'Umbrella ft. JAY-Z',
      artist: 'Rihanna',
    } as never);

    await service.download('EPtrQpx9VDw');

    expect(renameSync).toHaveBeenCalledWith(
      join(downloadsDir, rawName),
      join(downloadsDir, cleanedName),
    );
    expect(library.ingestDownloadedFile).toHaveBeenCalledWith(
      join(downloadsDir, cleanedName),
    );
  });
});
