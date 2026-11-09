import { describe, expect, it } from 'vitest';
import type { QueueItemDto } from '@karaokej/shared';
import {
  crossfadeGains,
  nextQueueItem,
  shouldPromoteCrossfade,
  shouldStartCrossfade,
  trackRemainingMs,
} from './crossfade';

function queueItem(id: number, position: number, trackId: number): QueueItemDto {
  return {
    id,
    position,
    addedAt: '2026-01-01T00:00:00.000Z',
    track: {
      id: trackId,
      title: `Track ${trackId}`,
      artist: null,
      album: null,
      albumArtist: null,
      trackNo: null,
      relativePath: `${trackId}.mp3`,
      format: 'mp3',
      durationMs: 180_000,
      lyricStatus: 'missing',
      lyricSource: null,
      rating: null,
      year: null,
      genres: [],
      metadataStatus: 'ready',
      audioVersion: 1_000 + trackId,
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
}

describe('nextQueueItem', () => {
  it('returns the next item by queue position', () => {
    const queue = [queueItem(1, 1, 10), queueItem(2, 2, 20), queueItem(3, 3, 30)];
    expect(nextQueueItem(queue, 1)).toEqual(queue[1]);
    expect(nextQueueItem(queue, 2)).toEqual(queue[2]);
  });

  it('returns null when there is no next item', () => {
    const queue = [queueItem(1, 1, 10), queueItem(2, 2, 20)];
    expect(nextQueueItem(queue, 2)).toBeNull();
    expect(nextQueueItem(queue, null)).toBeNull();
  });
});

describe('shouldStartCrossfade', () => {
  it('starts when remaining time is within the configured window', () => {
    expect(
      shouldStartCrossfade({
        enabledSeconds: 5,
        remainingMs: 4_900,
        durationMs: 180_000,
        hasNext: true,
        alreadyFading: false,
        playing: true,
      }),
    ).toBe(true);
  });

  it('does not start when duration is unknown', () => {
    expect(
      shouldStartCrossfade({
        enabledSeconds: 5,
        remainingMs: 0,
        durationMs: 0,
        hasNext: true,
        alreadyFading: false,
        playing: true,
      }),
    ).toBe(false);
  });

  it('does not start when disabled, paused, missing next, or already fading', () => {
    const base = {
      enabledSeconds: 5,
      remainingMs: 1_000,
      durationMs: 180_000,
      hasNext: true,
      alreadyFading: false,
      playing: true,
    };
    expect(shouldStartCrossfade({ ...base, enabledSeconds: 0 })).toBe(false);
    expect(shouldStartCrossfade({ ...base, playing: false })).toBe(false);
    expect(shouldStartCrossfade({ ...base, hasNext: false })).toBe(false);
    expect(shouldStartCrossfade({ ...base, alreadyFading: true })).toBe(false);
    expect(shouldStartCrossfade({ ...base, remainingMs: 6_000 })).toBe(false);
  });
});

describe('crossfadeGains', () => {
  it('ramps linearly from outgoing to incoming across the overlap', () => {
    expect(crossfadeGains(5_000, 5_000)).toEqual({ outgoing: 1, incoming: 0 });
    expect(crossfadeGains(2_500, 5_000)).toEqual({ outgoing: 0.5, incoming: 0.5 });
    expect(crossfadeGains(0, 5_000)).toEqual({ outgoing: 0, incoming: 1 });
  });

  it('freezes the mix for the remaining overlap length when paused mid-fade', () => {
    const first = crossfadeGains(2_000, 5_000);
    const second = crossfadeGains(2_000, 5_000);
    expect(first).toEqual(second);
    expect(first.outgoing).toBe(0.4);
    expect(first.incoming).toBe(0.6);
  });

  it('supports shorter tracks than the configured fade window', () => {
    expect(crossfadeGains(1_500, 3_000)).toEqual({ outgoing: 0.5, incoming: 0.5 });
    expect(crossfadeGains(0, 3_000)).toEqual({ outgoing: 0, incoming: 1 });
  });
});

describe('shouldPromoteCrossfade', () => {
  it('promotes when the session advances to the incoming track after a fade', () => {
    expect(
      shouldPromoteCrossfade({
        crossfade: {
          active: true,
          incomingTrackId: 20,
          incomingQueueItemId: 2,
          overlapStartRemainingMs: 5_000,
        },
        trackChanged: true,
        currentTrackId: 20,
      }),
    ).toBe(true);
  });

  it('does not promote on skip or unrelated track changes', () => {
    expect(
      shouldPromoteCrossfade({
        crossfade: {
          active: true,
          incomingTrackId: 20,
          incomingQueueItemId: 2,
          overlapStartRemainingMs: 5_000,
        },
        trackChanged: true,
        currentTrackId: 30,
      }),
    ).toBe(false);
  });
});

describe('trackRemainingMs', () => {
  it('returns zero when duration is unknown', () => {
    expect(trackRemainingMs(0, 12_000)).toBe(0);
  });

  it('never returns a negative remaining time', () => {
    expect(trackRemainingMs(60_000, 70_000)).toBe(0);
  });
});
