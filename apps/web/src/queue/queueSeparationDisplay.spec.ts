import { describe, expect, it } from 'vitest';
import { QueueItemDto } from '@karaokej/shared';
import { queueSeparationDisplay } from './queueSeparationDisplay';

const baseItem: QueueItemDto = {
  id: 1,
  position: 0,
  addedAt: '2026-01-01T00:00:00.000Z',
  track: {
    id: 42,
    relativePath: 'a/song.mp3',
    title: 'Song',
    artist: null,
    album: null,
    albumArtist: null,
    trackNo: null,
    durationMs: 1000,
    format: 'mp3',
    lyricStatus: 'missing',
    lyricSource: null,
    rating: null,
    year: null,
    genres: [],
    metadataStatus: 'ready',
    audioVersion: 1234,
    karaokeStemStatus: null,
    coverGroup: null,
    coverVersion: null,
    coverStatus: 'pending' as const,
    musicbrainzArtistId: null,
    tags: [],
    libraryPlacement: 'organized' as const,
  },
  stem: null,
};

describe('queueSeparationDisplay', () => {
  it('returns none when stem is absent or ready', () => {
    expect(
      queueSeparationDisplay(baseItem, {
        kind: 'separation',
        running: false,
        current: 0,
        total: 100,
        message: null,
      }),
    ).toEqual({ kind: 'none' });
    expect(
      queueSeparationDisplay(
        { ...baseItem, stem: { status: 'ready' } },
        {
          kind: 'separation',
          running: false,
          current: 0,
          total: 100,
          message: null,
        },
      ),
    ).toEqual({ kind: 'none' });
  });

  it('returns queued for pending stems', () => {
    expect(
      queueSeparationDisplay(
        { ...baseItem, stem: { status: 'pending' } },
        {
          kind: 'separation',
          running: false,
          current: 0,
          total: 100,
          message: null,
        },
      ),
    ).toEqual({ kind: 'queued' });
  });

  it('returns percent for the active separation job track', () => {
    expect(
      queueSeparationDisplay(
        { ...baseItem, stem: { status: 'processing' } },
        {
          kind: 'separation',
          running: true,
          current: 37,
          total: 100,
          message: 'Separating…',
          trackId: 42,
        },
      ),
    ).toEqual({ kind: 'progress', percent: 37 });
  });
});
