import { describe, expect, it, vi } from 'vitest';
import { MetadataSearchService } from './metadata-search.service';
import type { MetadataProviderClient } from './metadata-search.types';

function mockClient(
  id: MetadataProviderClient['id'],
  hits: Parameters<MetadataProviderClient['search']>[0] extends infer _Q
    ? Awaited<ReturnType<MetadataProviderClient['search']>>
    : never,
  shouldThrow = false,
): MetadataProviderClient {
  return {
    id,
    label: id,
    search: shouldThrow
      ? async () => {
          throw new Error(`${id} failed`);
        }
      : async () => hits,
    test: async () => ({ ok: true, message: 'ok' }),
  };
}

describe('MetadataSearchService', () => {
  it('stops at the first provider with hits', async () => {
    const settings = {
      getMetadataProvidersStored: () => ({
        order: ['musicbrainz', 'discogs', 'lastfm', 'gnudb', 'spotify', 'acoustid'],
        musicbrainz: { enabled: true, contactEmail: 'a@b.co' },
        discogs: { enabled: true, token: 't' },
        lastfm: { enabled: true, apiKey: 'k' },
        gnudb: { enabled: true, contactEmail: 'a@b.co' },
        spotify: {
          enabled: true,
          clientId: 'id',
          clientSecret: 'sec',
        },
        acoustid: { enabled: false, apiKey: '' },
      }),
    };
    const mb = mockClient('musicbrainz', []);
    const discogs = mockClient('discogs', [
      {
        providerId: 'discogs',
        providerLabel: 'Discogs',
        externalUrl: null,
        title: 'Hit',
        artist: 'A',
        album: null,
        albumArtist: null,
        trackNo: null,
        year: null,
        genres: [],
        musicbrainzArtistId: null,
        musicbrainzRecordingId: null,
        musicbrainzReleaseId: null,
        isrc: null,
        durationMs: null,
      },
    ]);
    const service = new MetadataSearchService(
      settings as never,
      { readFromFile: vi.fn() } as never,
      mb as never,
      discogs as never,
      mockClient('lastfm', []) as never,
      mockClient('gnudb', []) as never,
      mockClient('spotify', []) as never,
    );

    const result = await service.searchProviders(
      { text: 'q', title: 't', artist: 'a', album: null },
      ['musicbrainz', 'discogs'],
      'q',
    );
    expect(result.hits).toHaveLength(1);
    expect(result.triedProviders.map((t) => t.status)).toEqual([
      'no_results',
      'ok',
    ]);
  });

  it('continues after provider errors', async () => {
    const settings = {
      getMetadataProvidersStored: () => ({
        order: ['musicbrainz', 'discogs'],
        musicbrainz: { enabled: true, contactEmail: 'a@b.co' },
        discogs: { enabled: true, token: 't' },
        lastfm: { enabled: false, apiKey: '' },
        gnudb: { enabled: false, contactEmail: '' },
        spotify: { enabled: false, clientId: '', clientSecret: '' },
        acoustid: { enabled: false, apiKey: '' },
      }),
    };
    const mb = mockClient('musicbrainz', [], true);
    const discogs = mockClient('discogs', []);
    const service = new MetadataSearchService(
      settings as never,
      { readFromFile: vi.fn() } as never,
      mb as never,
      discogs as never,
      mockClient('lastfm', []) as never,
      mockClient('gnudb', []) as never,
      mockClient('spotify', []) as never,
    );

    const result = await service.searchProviders(
      { text: 'q', title: null, artist: null, album: null },
      ['musicbrainz', 'discogs'],
      'q',
    );
    expect(result.hits).toHaveLength(0);
    expect(result.triedProviders[0]?.status).toBe('error');
    expect(result.triedProviders[1]?.status).toBe('no_results');
  });
});
