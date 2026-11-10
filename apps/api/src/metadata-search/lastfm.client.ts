import { Injectable } from '@nestjs/common';
import type { MetadataSearchHitDto } from '@karaokej/shared';
import type {
  MetadataProviderClient,
  MetadataProviderContext,
  MetadataSearchQuery,
} from './metadata-search.types';

const BASE = 'https://ws.audioscrobbler.com/2.0/';

@Injectable()
export class LastFmMetadataClient implements MetadataProviderClient {
  readonly id = 'lastfm' as const;
  readonly label = 'Last.fm';

  async search(
    query: MetadataSearchQuery,
    context: MetadataProviderContext,
  ): Promise<MetadataSearchHitDto[]> {
    const apiKey = context.stored.lastfm.apiKey.trim();
    if (!apiKey) {
      return [];
    }
    const track = query.title ?? query.text;
    const artist = query.artist ?? '';
    if (!track) {
      return [];
    }
    const params = new URLSearchParams({
      method: 'track.search',
      track,
      api_key: apiKey,
      format: 'json',
      limit: '10',
    });
    if (artist) {
      params.set('artist', artist);
    }
    const response = await fetch(`${BASE}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Last.fm returned ${response.status}`);
    }
    const data = (await response.json()) as {
      results?: {
        trackmatches?: {
          track?: Array<{
            name?: string;
            artist?: string;
            url?: string;
          }>;
        };
      };
      error?: number;
      message?: string;
    };
    if (data.error) {
      throw new Error(data.message ?? `Last.fm error ${data.error}`);
    }
    const hits: MetadataSearchHitDto[] = [];
    for (const row of data.results?.trackmatches?.track ?? []) {
      hits.push({
        providerId: this.id,
        providerLabel: this.label,
        externalUrl: row.url?.trim() ?? null,
        title: row.name?.trim() || track,
        artist: row.artist?.trim() ?? (artist || null),
        album: query.album,
        albumArtist: row.artist?.trim() ?? null,
        trackNo: null,
        year: null,
        genres: [],
        musicbrainzArtistId: null,
        musicbrainzRecordingId: null,
        musicbrainzReleaseId: null,
        isrc: null,
        durationMs: null,
      });
    }
    return hits;
  }

  async test(
    context: MetadataProviderContext,
  ): Promise<{ ok: boolean; message: string }> {
    if (!context.stored.lastfm.apiKey.trim()) {
      return { ok: false, message: 'Save an API key first.' };
    }
    try {
      const hits = await this.search(
        {
          text: 'Queen Bohemian Rhapsody',
          title: 'Bohemian Rhapsody',
          artist: 'Queen',
          album: null,
        },
        context,
      );
      if (hits.length === 0) {
        return { ok: false, message: 'API key works but the test query returned no hits.' };
      }
      return { ok: true, message: `OK (${hits.length} hit${hits.length === 1 ? '' : 's'}).` };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
