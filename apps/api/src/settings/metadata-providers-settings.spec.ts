import { DEFAULT_METADATA_PROVIDER_ORDER } from '@karaokej/shared';
import { describe, expect, it } from 'vitest';
import {
  isProviderConfigured,
  mergeMetadataProvidersPatch,
  storedToPublicDto,
} from './metadata-providers-settings';

describe('metadata-providers-settings', () => {
  it('masks secret fields in public DTO', () => {
    const dto = storedToPublicDto({
      order: ['musicbrainz', 'discogs', 'lastfm', 'gnudb', 'spotify', 'acoustid'],
      musicbrainz: { enabled: true, contactEmail: 'me@example.com' },
      discogs: { enabled: true, token: 'secret-token' },
      lastfm: { enabled: false, apiKey: 'lk' },
      gnudb: { enabled: false, contactEmail: '' },
      spotify: { enabled: false, clientId: 'cid', clientSecret: 'sec' },
      acoustid: { enabled: false, apiKey: 'ak' },
    });
    expect(dto.discogs.token).toBe('');
    expect(dto.discogs.tokenSaved).toBe(true);
    expect(dto.spotify.clientSecretSaved).toBe(true);
  });

  it('keeps blank secret on patch', () => {
    const stored = {
      order: [...DEFAULT_METADATA_PROVIDER_ORDER],
      musicbrainz: { enabled: false, contactEmail: '' },
      discogs: { enabled: true, token: 'old' },
      lastfm: { enabled: false, apiKey: '' },
      gnudb: { enabled: false, contactEmail: '' },
      spotify: { enabled: false, clientId: '', clientSecret: '' },
      acoustid: { enabled: false, apiKey: '' },
    };
    const next = mergeMetadataProvidersPatch(stored, {
      discogs: { enabled: true, token: '', tokenSaved: true },
    });
    expect(next.discogs.token).toBe('old');
  });

  it('detects configured providers', () => {
    const stored = {
      order: [...DEFAULT_METADATA_PROVIDER_ORDER],
      musicbrainz: { enabled: false, contactEmail: 'a@b.co' },
      discogs: { enabled: false, token: '' },
      lastfm: { enabled: false, apiKey: 'x' },
      gnudb: { enabled: false, contactEmail: '' },
      spotify: { enabled: false, clientId: 'id', clientSecret: 'secret' },
      acoustid: { enabled: false, apiKey: '' },
    };
    expect(isProviderConfigured('musicbrainz', stored)).toBe(true);
    expect(isProviderConfigured('discogs', stored)).toBe(false);
    expect(isProviderConfigured('spotify', stored)).toBe(true);
  });
});
