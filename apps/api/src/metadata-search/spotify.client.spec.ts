import { afterEach, describe, expect, it, vi } from 'vitest';
import { SpotifyMetadataClient } from './spotify.client';

const context = {
  stored: {
    spotify: { clientId: 'id', clientSecret: 'secret' },
  },
} as never;

describe('SpotifyMetadataClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps duration_ms to durationMs', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            tracks: {
              items: [
                {
                  name: 'Test Song',
                  duration_ms: 245_000,
                  artists: [{ name: 'Artist' }],
                  album: { name: 'Album', release_date: '2020-01-01', artists: [] },
                  external_urls: { spotify: 'https://open.spotify.com/track/x' },
                },
              ],
            },
          }),
        }),
    );
    const client = new SpotifyMetadataClient();
    const hits = await client.search(
      { text: 'Artist Test Song', title: 'Test Song', artist: 'Artist', album: null },
      context,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.durationMs).toBe(245_000);
  });

  it('returns null duration when duration_ms is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            tracks: {
              items: [
                {
                  name: 'No Duration',
                  artists: [{ name: 'Artist' }],
                  album: { name: 'Album', release_date: '2020', artists: [] },
                },
              ],
            },
          }),
        }),
    );
    const client = new SpotifyMetadataClient();
    const hits = await client.search(
      { text: 'q', title: 'No Duration', artist: 'Artist', album: null },
      context,
    );
    expect(hits[0]!.durationMs).toBeNull();
  });
});
