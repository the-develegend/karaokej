import { Injectable } from '@nestjs/common';
import type { MetadataSearchHitDto } from '@karaokej/shared';
import type {
  MetadataProviderClient,
  MetadataProviderContext,
  MetadataSearchQuery,
} from './metadata-search.types';
import { sanitizeDurationMs } from '../library/duration-utils';
import { luceneEscape } from './query-utils';

const BASE = 'https://musicbrainz.org/ws/2';

@Injectable()
export class MusicBrainzMetadataClient implements MetadataProviderClient {
  readonly id = 'musicbrainz' as const;
  readonly label = 'MusicBrainz';
  private nextAllowedAt = 0;

  private async waitSpacing(): Promise<void> {
    const now = Date.now();
    const wait = Math.max(0, this.nextAllowedAt - now);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.nextAllowedAt = Date.now() + 1100;
  }

  private userAgent(context: MetadataProviderContext): string {
    const email = context.stored.musicbrainz.contactEmail.trim();
    return `Karaokej/0.1.0 (${email || 'no-contact@example.invalid'})`;
  }

  private buildSearchQuery(query: MetadataSearchQuery): string {
    const parts: string[] = [];
    if (query.artist) {
      parts.push(`artist:"${luceneEscape(query.artist)}"`);
    }
    if (query.title) {
      parts.push(`recording:"${luceneEscape(query.title)}"`);
    }
    if (parts.length === 0 && query.text) {
      return query.text;
    }
    return parts.join(' AND ');
  }

  async search(
    query: MetadataSearchQuery,
    context: MetadataProviderContext,
  ): Promise<MetadataSearchHitDto[]> {
    const mbQuery = this.buildSearchQuery(query);
    if (!mbQuery) {
      return [];
    }
    await this.waitSpacing();
    const url = `${BASE}/recording?query=${encodeURIComponent(mbQuery)}&fmt=json&limit=10`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': this.userAgent(context),
      },
    });
    if (!response.ok) {
      throw new Error(`MusicBrainz returned ${response.status}`);
    }
    const data = (await response.json()) as {
      recordings?: Array<{
        id?: string;
        title?: string;
        length?: number;
        'artist-credit'?: Array<{ artist?: { id?: string; name?: string } }>;
        releases?: Array<{
          id?: string;
          title?: string;
          date?: string;
          'track-count'?: number;
          'artist-credit'?: Array<{ artist?: { name?: string } }>;
        }>;
        isrcs?: string[];
      }>;
    };
    const hits: MetadataSearchHitDto[] = [];
    for (const rec of data.recordings ?? []) {
      const artist =
        rec['artist-credit']?.[0]?.artist?.name?.trim() ?? query.artist;
      const artistId = rec['artist-credit']?.[0]?.artist?.id?.trim() ?? null;
      const release = rec.releases?.[0];
      const year = release?.date
        ? Number.parseInt(release.date.slice(0, 4), 10)
        : null;
      hits.push({
        providerId: this.id,
        providerLabel: this.label,
        externalUrl: rec.id
          ? `https://musicbrainz.org/recording/${rec.id}`
          : null,
        title: rec.title?.trim() || query.title || '',
        artist: artist ?? null,
        album: release?.title?.trim() ?? query.album,
        albumArtist:
          release?.['artist-credit']?.[0]?.artist?.name?.trim() ?? artist ?? null,
        trackNo: null,
        year: year && year > 0 ? year : null,
        genres: [],
        musicbrainzArtistId: artistId,
        musicbrainzRecordingId: rec.id?.trim() ?? null,
        musicbrainzReleaseId: release?.id?.trim() ?? null,
        isrc: rec.isrcs?.[0]?.trim() ?? null,
        durationMs: sanitizeDurationMs(rec.length),
      });
    }
    return hits;
  }

  async test(
    context: MetadataProviderContext,
  ): Promise<{ ok: boolean; message: string }> {
    if (!context.stored.musicbrainz.contactEmail.includes('@')) {
      return { ok: false, message: 'Enter a contact email first.' };
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
        return { ok: false, message: 'Connected but the test query returned no hits.' };
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
