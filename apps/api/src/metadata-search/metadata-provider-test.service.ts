import { BadRequestException, Injectable } from '@nestjs/common';
import type { MetadataProviderId, MetadataProviderTestResultDto } from '@karaokej/shared';
import { METADATA_SETTINGS_PROVIDER_IDS } from '@karaokej/shared';
import { SettingsService } from '../settings/settings.service';
import { isProviderConfigured } from '../settings/metadata-providers-settings';
import { MusicBrainzMetadataClient } from './musicbrainz.client';
import { DiscogsMetadataClient } from './discogs.client';
import { LastFmMetadataClient } from './lastfm.client';
import { GnuDbMetadataClient } from './gnudb.client';
import { SpotifyMetadataClient } from './spotify.client';
import { AcoustIdMetadataClient } from './acoustid.client';

@Injectable()
export class MetadataProviderTestService {
  constructor(
    private readonly settings: SettingsService,
    private readonly musicbrainz: MusicBrainzMetadataClient,
    private readonly discogs: DiscogsMetadataClient,
    private readonly lastfm: LastFmMetadataClient,
    private readonly gnudb: GnuDbMetadataClient,
    private readonly spotify: SpotifyMetadataClient,
    private readonly acoustid: AcoustIdMetadataClient,
  ) {}

  async test(id: MetadataProviderId): Promise<MetadataProviderTestResultDto> {
    if (
      !(METADATA_SETTINGS_PROVIDER_IDS as readonly string[]).includes(id)
    ) {
      throw new BadRequestException('Unknown metadata provider');
    }
    const stored = this.settings.getMetadataProvidersStored();
    if (!isProviderConfigured(id, stored)) {
      return {
        ok: false,
        message: 'Save the required credentials before testing.',
      };
    }
    const context = { stored };
    switch (id) {
      case 'musicbrainz':
        return this.musicbrainz.test(context);
      case 'discogs':
        return this.discogs.test(context);
      case 'lastfm':
        return this.lastfm.test(context);
      case 'gnudb':
        return this.gnudb.test(context);
      case 'spotify':
        return this.spotify.test(context);
      case 'acoustid':
        return this.acoustid.test(context);
      default:
        return { ok: false, message: 'Unknown provider' };
    }
  }
}
