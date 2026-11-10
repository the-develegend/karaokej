import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicBrainzMetadataClient } from './musicbrainz.client';

const context = {
  stored: {
    musicbrainz: { contactEmail: 'test@example.com' },
  },
} as never;

describe('MusicBrainzMetadataClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps recording length to durationMs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          recordings: [
            {
              id: 'rec-id',
              title: 'Test Song',
              length: 354_320,
              'artist-credit': [{ artist: { id: 'art-id', name: 'Artist' } }],
              releases: [{ id: 'rel-id', title: 'Album', date: '2020' }],
            },
          ],
        }),
      }),
    );
    const client = new MusicBrainzMetadataClient();
    const hits = await client.search(
      { text: 'Artist Test Song', title: 'Test Song', artist: 'Artist', album: null },
      context,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.durationMs).toBe(354_320);
  });

  it('returns null duration when length is missing or invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          recordings: [
            {
              id: 'rec-id',
              title: 'No Length',
              'artist-credit': [{ artist: { name: 'Artist' } }],
            },
            {
              id: 'rec-id-2',
              title: 'Zero',
              length: 0,
              'artist-credit': [{ artist: { name: 'Artist' } }],
            },
          ],
        }),
      }),
    );
    const client = new MusicBrainzMetadataClient();
    const hits = await client.search(
      { text: 'q', title: 'No Length', artist: 'Artist', album: null },
      context,
    );
    expect(hits[0]!.durationMs).toBeNull();
    expect(hits[1]!.durationMs).toBeNull();
  });
});
