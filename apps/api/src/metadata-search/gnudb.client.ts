import { Injectable } from '@nestjs/common';
import type { MetadataSearchHitDto } from '@karaokej/shared';
import type {
  MetadataProviderClient,
  MetadataProviderContext,
  MetadataSearchQuery,
} from './metadata-search.types';

const BASE = 'https://gnudb.gnudb.org/~cddb/cddb.cgi';

@Injectable()
export class GnuDbMetadataClient implements MetadataProviderClient {
  readonly id = 'gnudb' as const;
  readonly label = 'GnuDB';

  private hello(context: MetadataProviderContext): string {
    const email = context.stored.gnudb.contactEmail.trim() || 'user@example.invalid';
    return `karaokej 0.1.0 ${email}`;
  }

  async search(
    query: MetadataSearchQuery,
    context: MetadataProviderContext,
  ): Promise<MetadataSearchHitDto[]> {
    if (!context.stored.gnudb.contactEmail.includes('@')) {
      return [];
    }
    const artist = query.artist ?? '';
    const title = query.title ?? query.text;
    if (!artist && !title) {
      return [];
    }
    const params = new URLSearchParams({
      cmd: 'cddb search',
      cat: 'misc',
      artist: artist || title || '',
      title: title || artist || '',
      hello: this.hello(context),
      proto: '6',
      fmt: 'json',
    });
    const response = await fetch(`${BASE}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`GnuDB returned ${response.status}`);
    }
    const text = await response.text();
    const hits = this.parseJsonOrText(text, query);
    return hits;
  }

  private parseJsonOrText(
    body: string,
    query: MetadataSearchQuery,
  ): MetadataSearchHitDto[] {
    try {
      const data = JSON.parse(body) as {
        data?: Array<{ title?: string; artist?: string; year?: number | string }>;
      };
      if (Array.isArray(data.data)) {
        return data.data.slice(0, 10).map((row) => ({
          providerId: this.id,
          providerLabel: this.label,
          externalUrl: 'https://gnudb.org/',
          title: query.title || row.title?.trim() || '',
          artist: row.artist?.trim() ?? query.artist,
          album: row.title?.trim() ?? query.album,
          albumArtist: row.artist?.trim() ?? query.artist,
          trackNo: null,
          year: this.parseYear(row.year),
          genres: [],
          musicbrainzArtistId: null,
          musicbrainzRecordingId: null,
          musicbrainzReleaseId: null,
          isrc: null,
          durationMs: null,
        }));
      }
    } catch {
      // fall through to plain-text parsing
    }
    const hits: MetadataSearchHitDto[] = [];
    for (const line of body.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const match = /^(.*?)\s+\/\s+(.*?)(?:\s+\/\s+(\d{4}))?/.exec(trimmed);
      if (!match) {
        continue;
      }
      hits.push({
        providerId: this.id,
        providerLabel: this.label,
        externalUrl: 'https://gnudb.org/',
        title: query.title || match[2]?.trim() || '',
        artist: match[1]?.trim() ?? query.artist,
        album: match[2]?.trim() ?? query.album,
        albumArtist: match[1]?.trim() ?? query.artist,
        trackNo: null,
        year: match[3] ? Number.parseInt(match[3], 10) : null,
        genres: [],
        musicbrainzArtistId: null,
        musicbrainzRecordingId: null,
        musicbrainzReleaseId: null,
        isrc: null,
        durationMs: null,
      });
      if (hits.length >= 10) {
        break;
      }
    }
    return hits;
  }

  private parseYear(value: number | string | undefined): number | null {
    if (value == null) {
      return null;
    }
    const year = Number.parseInt(String(value), 10);
    return year > 0 ? year : null;
  }

  async test(
    context: MetadataProviderContext,
  ): Promise<{ ok: boolean; message: string }> {
    if (!context.stored.gnudb.contactEmail.includes('@')) {
      return { ok: false, message: 'Enter a contact email first.' };
    }
    try {
      const hits = await this.search(
        {
          text: 'Beatles Abbey Road',
          title: 'Come Together',
          artist: 'The Beatles',
          album: 'Abbey Road',
        },
        context,
      );
      if (hits.length === 0) {
        return {
          ok: true,
          message: 'Connected (test query returned no fuzzy hits; search may still work).',
        };
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
