import { Injectable } from '@nestjs/common';
import type { MetadataSearchHitDto } from '@karaokej/shared';
import type {
  MetadataProviderClient,
  MetadataProviderContext,
  MetadataSearchQuery,
} from './metadata-search.types';

const BASE = 'https://api.discogs.com';

@Injectable()
export class DiscogsMetadataClient implements MetadataProviderClient {
  readonly id = 'discogs' as const;
  readonly label = 'Discogs';

  async search(
    query: MetadataSearchQuery,
    context: MetadataProviderContext,
  ): Promise<MetadataSearchHitDto[]> {
    const token = context.stored.discogs.token.trim();
    if (!token) {
      return [];
    }
    const q = query.text || [query.artist, query.title].filter(Boolean).join(' ');
    if (!q) {
      return [];
    }
    const url = `${BASE}/database/search?q=${encodeURIComponent(q)}&type=release&per_page=10`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Discogs token=${token}`,
        'User-Agent': 'Karaokej/0.1.0 +https://github.com/',
      },
    });
    if (!response.ok) {
      throw new Error(`Discogs returned ${response.status}`);
    }
    const data = (await response.json()) as {
      results?: Array<{
        id?: number;
        title?: string;
        year?: string;
        genre?: string[];
        style?: string[];
        type?: string;
      }>;
    };
    const hits: MetadataSearchHitDto[] = [];
    for (const row of data.results ?? []) {
      if (row.type && row.type !== 'release') {
        continue;
      }
      const genres = [...(row.genre ?? []), ...(row.style ?? [])].filter(Boolean);
      const year = row.year ? Number.parseInt(String(row.year), 10) : null;
      hits.push({
        providerId: this.id,
        providerLabel: this.label,
        externalUrl: row.id ? `https://www.discogs.com/release/${row.id}` : null,
        title: query.title || row.title?.split(' - ').pop()?.trim() || row.title || '',
        artist: query.artist ?? row.title?.split(' - ')[0]?.trim() ?? null,
        album: row.title?.includes(' - ')
          ? row.title.split(' - ').slice(1).join(' - ').trim()
          : row.title?.trim() ?? query.album,
        albumArtist: query.artist,
        trackNo: null,
        year: year && year > 0 ? year : null,
        genres,
        musicbrainzArtistId: null,
        musicbrainzRecordingId: null,
        musicbrainzReleaseId: null,
        isrc: null,
      });
    }
    return hits;
  }

  async test(
    context: MetadataProviderContext,
  ): Promise<{ ok: boolean; message: string }> {
    if (!context.stored.discogs.token.trim()) {
      return { ok: false, message: 'Save a personal access token first.' };
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
        return { ok: false, message: 'Token accepted but the test query returned no hits.' };
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
