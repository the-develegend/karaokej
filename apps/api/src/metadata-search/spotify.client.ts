import { Injectable } from '@nestjs/common';
import type { MetadataSearchHitDto } from '@karaokej/shared';
import type {
  MetadataProviderClient,
  MetadataProviderContext,
  MetadataSearchQuery,
} from './metadata-search.types';

@Injectable()
export class SpotifyMetadataClient implements MetadataProviderClient {
  readonly id = 'spotify' as const;
  readonly label = 'Spotify';
  private cachedToken: { token: string; expiresAt: number } | null = null;

  private async accessToken(
    context: MetadataProviderContext,
  ): Promise<string> {
    const clientId = context.stored.spotify.clientId.trim();
    const clientSecret = context.stored.spotify.clientSecret.trim();
    if (!clientId || !clientSecret) {
      throw new Error('Spotify client ID and secret are required');
    }
    const now = Date.now();
    if (this.cachedToken && this.cachedToken.expiresAt > now + 30_000) {
      return this.cachedToken.token;
    }
    const body = new URLSearchParams({ grant_type: 'client_credentials' });
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Spotify auth returned ${response.status}`);
    }
    const data = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) {
      throw new Error('Spotify auth returned no token');
    }
    this.cachedToken = {
      token: data.access_token,
      expiresAt: now + (data.expires_in ?? 3600) * 1000,
    };
    return data.access_token;
  }

  async search(
    query: MetadataSearchQuery,
    context: MetadataProviderContext,
  ): Promise<MetadataSearchHitDto[]> {
    const q = query.text || [query.artist, query.title].filter(Boolean).join(' ');
    if (!q) {
      return [];
    }
    const token = await this.accessToken(context);
    const params = new URLSearchParams({ q, type: 'track', limit: '10' });
    const response = await fetch(
      `https://api.spotify.com/v1/search?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Spotify returned ${response.status}`);
    }
    const data = (await response.json()) as {
      tracks?: {
        items?: Array<{
          name?: string;
          external_urls?: { spotify?: string };
          track_number?: number;
          disc_number?: number;
          external_ids?: { isrc?: string };
          album?: {
            name?: string;
            release_date?: string;
            artists?: Array<{ name?: string }>;
          };
          artists?: Array<{ name?: string }>;
        }>;
      };
    };
    const hits: MetadataSearchHitDto[] = [];
    for (const track of data.tracks?.items ?? []) {
      const year = track.album?.release_date
        ? Number.parseInt(track.album.release_date.slice(0, 4), 10)
        : null;
      hits.push({
        providerId: this.id,
        providerLabel: this.label,
        externalUrl: track.external_urls?.spotify ?? null,
        title: track.name?.trim() || query.title || '',
        artist: track.artists?.[0]?.name?.trim() ?? query.artist,
        album: track.album?.name?.trim() ?? query.album,
        albumArtist:
          track.album?.artists?.[0]?.name?.trim() ??
          track.artists?.[0]?.name?.trim() ??
          null,
        trackNo: track.track_number ?? null,
        year: year && year > 0 ? year : null,
        genres: [],
        musicbrainzArtistId: null,
        musicbrainzRecordingId: null,
        musicbrainzReleaseId: null,
        isrc: track.external_ids?.isrc?.trim() ?? null,
      });
    }
    return hits;
  }

  async test(
    context: MetadataProviderContext,
  ): Promise<{ ok: boolean; message: string }> {
    if (
      !context.stored.spotify.clientId.trim() ||
      !context.stored.spotify.clientSecret.trim()
    ) {
      return { ok: false, message: 'Save client ID and secret first.' };
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
        return { ok: false, message: 'Credentials work but the test query returned no hits.' };
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
