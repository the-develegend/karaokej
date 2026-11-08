import { describe, expect, it } from 'vitest';
import { createTestDb } from '../test/test-db';
import { upsertPathTrack, upsertTagsTrack } from './scan-track-upsert';
import type { ScanChunkItem } from './scan-ipc';

function sampleItem(overrides: Partial<ScanChunkItem> = {}): ScanChunkItem {
  return {
    absolutePath: '/music/Artist/Album/Artist - Song Title.mp3',
    relativePath: 'Artist/Album/Artist - Song Title.mp3',
    sizeBytes: 4_000_000,
    mtimeMs: 1_700_000_000_000,
    format: 'mp3',
    unchanged: false,
    hasLrc: false,
    metadata: null,
    ...overrides,
  };
}

describe('upsertPathTrack', () => {
  it('inserts a pending track from path-derived metadata', () => {
    const { db, cleanup } = createTestDb();
    try {
      const now = Date.now();
      upsertPathTrack(db.raw, sampleItem(), now);
      const row = db.raw
        .prepare(`SELECT title, artist, album, metadata_status, duration_ms FROM tracks WHERE relative_path = ?`)
        .get('Artist/Album/Artist - Song Title.mp3') as {
        title: string;
        artist: string;
        album: string;
        metadata_status: string;
        duration_ms: number | null;
      };
      expect(row.metadata_status).toBe('pending');
      expect(row.title).toBe('Song Title');
      expect(row.artist).toBe('Artist');
      expect(row.album).toBe('Album');
      expect(row.duration_ms).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('upsertTagsTrack', () => {
  it('promotes a pending track to ready with parsed tags', () => {
    const { db, cleanup } = createTestDb();
    try {
      const now = Date.now();
      const item = sampleItem();
      upsertPathTrack(db.raw, item, now);
      upsertTagsTrack(
        db.raw,
        item,
        {
          title: 'Real Title',
          artist: 'Real Artist',
          album: 'Real Album',
          albumArtist: 'Real Artist',
          trackNo: 3,
          durationMs: 245_000,
          rating: 8,
          year: 1999,
          genres: ['Rock'],
          musicbrainzArtistId: null,
          musicbrainzRecordingId: null,
          musicbrainzReleaseId: null,
          isrc: null,
          moodValues: [],
        },
        now + 1,
      );
      const row = db.raw
        .prepare(`SELECT title, metadata_status, duration_ms, rating FROM tracks WHERE relative_path = ?`)
        .get(item.relativePath) as {
        title: string;
        metadata_status: string;
        duration_ms: number;
        rating: number;
      };
      expect(row.metadata_status).toBe('ready');
      expect(row.title).toBe('Real Title');
      expect(row.duration_ms).toBe(245_000);
      expect(row.rating).toBe(8);
    } finally {
      cleanup();
    }
  });
});
