import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { LyricsService } from './lyrics.service';
import { LibraryService } from '../library/library.service';
import { createMockSession } from '../test/mock-session';
import { createMockSeparation } from '../test/mock-separation';
import {
  createMockLibraryConfig,
  createMockLibrarySettings,
} from '../test/mock-library-deps';
import { createTestDb, insertTrack, TestDbService } from '../test/test-db';

const NOT_FOUND_COOLDOWN_MS = 60 * 24 * 60 * 60 * 1000;

function bulkFetchCandidates(db: TestDbService): Array<{ id: number; lyric_status: string }> {
  return db.raw
    .prepare(
      `SELECT id, lyric_status FROM tracks
       WHERE available = 1
         AND metadata_status = 'ready'
         AND (lyric_status IN ('missing', 'error')
          OR (lyric_status = 'not_found' AND (lyric_checked_at IS NULL OR lyric_checked_at < ?)))
       ORDER BY artist COLLATE NOCASE, title COLLATE NOCASE`,
    )
    .all(Date.now() - NOT_FOUND_COOLDOWN_MS) as Array<{ id: number; lyric_status: string }>;
}

describe('LyricsService', () => {
  let db: TestDbService;
  let cleanup: () => void;
  let library: LibraryService;
  let session: ReturnType<typeof createMockSession>;
  let lyrics: LyricsService;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    session = createMockSession(db);
    library = new LibraryService(
      db as never,
      createMockLibraryConfig() as never,
      session,
      createMockSeparation(),
      createMockLibrarySettings() as never,
    );
    lyrics = new LyricsService(
      db as never,
      { libraryPaths: [], resolveUnderLibrary: () => null } as never,
      library,
      session,
      { getBest: vi.fn(), searchQuery: vi.fn(), getById: vi.fn(), waitForSpacing: vi.fn() } as never,
    );
  });

  afterEach(() => {
    cleanup();
  });

  describe('markUnavailable', () => {
    it('sets lyric_status to unavailable and persists lyric_memory', async () => {
      const trackId = insertTrack(db, {
        relativePath: 'a/song.mp3',
        title: 'Song',
        artist: 'Artist',
        lyricStatus: 'not_found',
      });
      db.raw
        .prepare(`UPDATE tracks SET fingerprint = ? WHERE id = ?`)
        .run('fp-test', trackId);

      const updated = await lyrics.markUnavailable(trackId);

      expect(updated.lyricStatus).toBe('unavailable');
      const row = db.raw
        .prepare(`SELECT lyric_status, lyric_checked_at FROM tracks WHERE id = ?`)
        .get(trackId) as { lyric_status: string; lyric_checked_at: number };
      expect(row.lyric_status).toBe('unavailable');
      expect(row.lyric_checked_at).toBeTypeOf('number');

      const memory = db.raw
        .prepare(`SELECT lyric_status FROM lyric_memory WHERE fingerprint = ?`)
        .get('fp-test') as { lyric_status: string };
      expect(memory.lyric_status).toBe('unavailable');
      expect(session.broadcast).toHaveBeenCalled();
    });

    it('throws when track does not exist', async () => {
      await expect(lyrics.markUnavailable(9999)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('bulk fetch candidates', () => {
    it('includes missing and error tracks', () => {
      const missingId = insertTrack(db, {
        relativePath: 'a/missing.mp3',
        title: 'Missing',
        artist: 'A',
        lyricStatus: 'missing',
      });
      const errorId = insertTrack(db, {
        relativePath: 'a/error.mp3',
        title: 'Error',
        artist: 'A',
        lyricStatus: 'error',
      });

      const ids = bulkFetchCandidates(db).map((row) => row.id);
      expect(ids).toContain(missingId);
      expect(ids).toContain(errorId);
    });

    it('excludes unavailable tracks', () => {
      const unavailableId = insertTrack(db, {
        relativePath: 'a/unavailable.mp3',
        title: 'Unavailable',
        artist: 'A',
        lyricStatus: 'unavailable',
      });

      const ids = bulkFetchCandidates(db).map((row) => row.id);
      expect(ids).not.toContain(unavailableId);
    });

    it('excludes recent not_found but includes cooled-down not_found', () => {
      const recentId = insertTrack(db, {
        relativePath: 'a/recent.mp3',
        title: 'Recent',
        artist: 'A',
        lyricStatus: 'not_found',
      });
      db.raw
        .prepare(`UPDATE tracks SET lyric_checked_at = ? WHERE id = ?`)
        .run(Date.now(), recentId);

      const oldId = insertTrack(db, {
        relativePath: 'a/old.mp3',
        title: 'Old',
        artist: 'A',
        lyricStatus: 'not_found',
      });
      db.raw
        .prepare(`UPDATE tracks SET lyric_checked_at = ? WHERE id = ?`)
        .run(Date.now() - NOT_FOUND_COOLDOWN_MS - 1, oldId);

      const ids = bulkFetchCandidates(db).map((row) => row.id);
      expect(ids).not.toContain(recentId);
      expect(ids).toContain(oldId);
    });
  });
});
