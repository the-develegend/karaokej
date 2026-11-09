import { describe, expect, it } from 'vitest';
import { defaultKaraokeState } from '@karaokej/shared';
import { planSourceSwap, resolveAudioSrc } from './resolveAudioSrc';

const track = {
  id: 42,
  relativePath: 'a/song.mp3',
  title: 'Song',
  artist: null,
  album: null,
  albumArtist: null,
  trackNo: null,
  durationMs: 1000,
  format: 'mp3' as const,
  lyricStatus: 'missing' as const,
  lyricSource: null,
  rating: null,
  year: null,
  genres: [],
  metadataStatus: 'ready' as const,
  audioVersion: 5_012_345,
  karaokeStemStatus: null,
  coverGroup: null,
  coverVersion: null,
  coverStatus: 'pending' as const,
  musicbrainzArtistId: null,
  tags: [],
  libraryPlacement: 'organized' as const,
};

describe('resolveAudioSrc', () => {
  it('uses normal audio when karaoke is off', () => {
    expect(resolveAudioSrc(track, defaultKaraokeState())).toBe(
      '/api/tracks/42/audio?v=5012345',
    );
  });

  it('changes the url when a rewrite moved the audio frames', () => {
    expect(
      resolveAudioSrc({ ...track, audioVersion: 5_016_441 }, defaultKaraokeState()),
    ).not.toBe(resolveAudioSrc(track, defaultKaraokeState()));
  });

  it('uses stem url when ai mode and stem is ready', () => {
    const karaoke = {
      ...defaultKaraokeState(),
      mode: 'ai' as const,
      stem: {
        trackId: 42,
        status: 'ready' as const,
        url: '/api/tracks/42/karaoke-stem',
        model: 'htdemucs',
        modelVersion: 'htdemucs',
        processedAt: null,
        error: null,
      },
    };
    expect(resolveAudioSrc(track, karaoke)).toBe('/api/tracks/42/karaoke-stem');
  });
});

describe('planSourceSwap', () => {
  it('does not swap when src is unchanged', () => {
    expect(
      planSourceSwap({
        currentSrc: '/api/tracks/42/audio',
        nextSrc: '/api/tracks/42/audio',
        currentTime: 12,
        paused: false,
      }),
    ).toEqual({
      shouldSwap: false,
      restoreTo: null,
      resumePlayback: false,
    });
  });

  it('preserves position when swapping mid-song', () => {
    expect(
      planSourceSwap({
        currentSrc: '/api/tracks/42/audio',
        nextSrc: '/api/tracks/42/karaoke-stem',
        currentTime: 87.5,
        paused: false,
      }),
    ).toEqual({
      shouldSwap: true,
      restoreTo: 87.5,
      resumePlayback: true,
    });
  });

  it('does not resume when paused', () => {
    expect(
      planSourceSwap({
        currentSrc: '/api/tracks/42/audio',
        nextSrc: '/api/tracks/42/karaoke-stem',
        currentTime: 10,
        paused: true,
      }).resumePlayback,
    ).toBe(false);
  });
});
