import { BadRequestException, Injectable } from '@nestjs/common';
import {
  METADATA_SEARCH_PROVIDER_IDS,
  MetadataProviderTriedDto,
  MetadataSearchProviderId,
  MetadataSearchResponseDto,
} from '@karaokej/shared';
import { SettingsService } from '../settings/settings.service';
import { TrackMetadataService } from '../metadata/track-metadata.service';
import { isProviderConfigured, metadataProviderLabel } from '../settings/metadata-providers-settings';
import type { MetadataProviderClient } from './metadata-search.types';
import { defaultQueryFromTags } from './query-utils';
import { MusicBrainzMetadataClient } from './musicbrainz.client';
import { DiscogsMetadataClient } from './discogs.client';
import { LastFmMetadataClient } from './lastfm.client';
import { GnuDbMetadataClient } from './gnudb.client';
import { SpotifyMetadataClient } from './spotify.client';

@Injectable()
export class MetadataSearchService {
  constructor(
    private readonly settings: SettingsService,
    private readonly trackMetadata: TrackMetadataService,
    private readonly musicbrainz: MusicBrainzMetadataClient,
    private readonly discogs: DiscogsMetadataClient,
    private readonly lastfm: LastFmMetadataClient,
    private readonly gnudb: GnuDbMetadataClient,
    private readonly spotify: SpotifyMetadataClient,
  ) {}

  private clientMap(): Map<MetadataSearchProviderId, MetadataProviderClient> {
    return new Map(
      [this.musicbrainz, this.discogs, this.lastfm, this.gnudb, this.spotify].map(
        (client) => [client.id, client],
      ),
    );
  }

  private resolveProviderIds(
    requested: MetadataSearchProviderId[] | undefined,
  ): MetadataSearchProviderId[] {
    const stored = this.settings.getMetadataProvidersStored();
    const order = stored.order.filter((id): id is MetadataSearchProviderId =>
      (METADATA_SEARCH_PROVIDER_IDS as readonly string[]).includes(id),
    );
    const configured = order.filter((id) => isProviderConfigured(id, stored));
    const source = requested?.length
      ? requested.filter((id) =>
          (METADATA_SEARCH_PROVIDER_IDS as readonly string[]).includes(id),
        )
      : configured.filter((id) => {
          switch (id) {
            case 'musicbrainz':
              return stored.musicbrainz.enabled;
            case 'discogs':
              return stored.discogs.enabled;
            case 'lastfm':
              return stored.lastfm.enabled;
            case 'gnudb':
              return stored.gnudb.enabled;
            case 'spotify':
              return stored.spotify.enabled;
            default:
              return false;
          }
        });
    return source.filter(
      (id) => isProviderConfigured(id, stored),
    );
  }

  async searchTrack(
    trackId: number,
    queryOverride: string | undefined,
    providerIds: MetadataSearchProviderId[] | undefined,
  ): Promise<MetadataSearchResponseDto> {
    const onDisk = await this.trackMetadata.readFromFile(trackId);
    const baseQuery = defaultQueryFromTags({
      title: onDisk.title,
      artist: onDisk.artist,
      album: onDisk.album,
    });
    const queryText = queryOverride?.trim() || baseQuery.text;
    if (!queryText) {
      throw new BadRequestException('Nothing to search for');
    }
    const searchQuery = queryOverride?.trim()
      ? {
          text: queryText,
          title: null,
          artist: null,
          album: onDisk.album,
        }
      : baseQuery;
    return this.searchProviders(searchQuery, providerIds, queryText);
  }

  async searchProviders(
    searchQuery: Parameters<MetadataProviderClient['search']>[0],
    providerIds: MetadataSearchProviderId[] | undefined,
    queryUsed?: string,
  ): Promise<MetadataSearchResponseDto> {
    const stored = this.settings.getMetadataProvidersStored();
    const context = { stored };
    const ids = this.resolveProviderIds(providerIds);
    const clients = this.clientMap();
    const triedProviders: MetadataProviderTriedDto[] = [];
    let hits: MetadataSearchResponseDto['hits'] = [];

    for (const id of ids) {
      const client = clients.get(id);
      const label = metadataProviderLabel(id);
      if (!client) {
        triedProviders.push({
          id,
          label,
          status: 'skipped',
          message: 'Provider unavailable.',
        });
        continue;
      }
      if (!isProviderConfigured(id, stored)) {
        triedProviders.push({
          id,
          label,
          status: 'skipped',
          message: 'Not configured.',
        });
        continue;
      }
      try {
        const found = await client.search(searchQuery, context);
        if (found.length === 0) {
          triedProviders.push({ id, label, status: 'no_results' });
          continue;
        }
        hits = found;
        triedProviders.push({
          id,
          label,
          status: 'ok',
          message: `${found.length} result${found.length === 1 ? '' : 's'}`,
        });
        break;
      } catch (err) {
        triedProviders.push({
          id,
          label,
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      hits,
      triedProviders,
      queryUsed: queryUsed ?? searchQuery.text,
    };
  }
}
