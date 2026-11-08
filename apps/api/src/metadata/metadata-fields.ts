import type { AudioFormat } from '@karaokej/shared';
import type { ParsedTrackMetadata } from '../library/scan-ipc';
import { clampRating } from '../rating/rating-scale';

const MBID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISRC_RE = /^[A-Z0-9]{5}[0-9]{7}$/i;

export interface EditableTrackMetadata {
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  year: number | null;
  genres: string[];
  rating: number;
  musicbrainzArtistId: string | null;
  musicbrainzRecordingId: string | null;
  musicbrainzReleaseId: string | null;
  isrc: string | null;
}

export interface TrackMetadataFileDto extends EditableTrackMetadata {
  durationMs: number | null;
  format: AudioFormat;
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMbid(value: unknown): string | null {
  if (typeof value !== 'string') {
    return value === null ? null : null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return MBID_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeIsrc(value: unknown): string | null {
  if (typeof value !== 'string') {
    return value === null ? null : null;
  }
  const trimmed = value.trim().toUpperCase();
  if (!trimmed) {
    return null;
  }
  return ISRC_RE.test(trimmed) ? trimmed : trimmed;
}

function normalizeGenres(genres: string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const genre of genres) {
    const trimmed = genre.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(trimmed);
  }
  return next;
}

export function editableFromParsed(parsed: ParsedTrackMetadata): EditableTrackMetadata {
  return {
    title: parsed.title.trim(),
    artist: normalizeOptionalString(parsed.artist),
    album: normalizeOptionalString(parsed.album),
    albumArtist: normalizeOptionalString(parsed.albumArtist),
    trackNo: parsed.trackNo,
    year: parsed.year,
    genres: normalizeGenres(parsed.genres),
    rating: clampRating(parsed.rating ?? 0),
    musicbrainzArtistId: normalizeMbid(parsed.musicbrainzArtistId),
    musicbrainzRecordingId: normalizeMbid(parsed.musicbrainzRecordingId),
    musicbrainzReleaseId: normalizeMbid(parsed.musicbrainzReleaseId),
    isrc: normalizeIsrc(parsed.isrc),
  };
}

export function normalizeEditableMetadata(
  input: Partial<EditableTrackMetadata> & { title?: unknown },
): EditableTrackMetadata {
  const title =
    typeof input.title === 'string' && input.title.trim().length > 0
      ? input.title.trim()
      : '';
  const artist =
    typeof input.artist === 'string'
      ? normalizeOptionalString(input.artist)
      : input.artist === null
        ? null
        : null;
  const album =
    typeof input.album === 'string'
      ? normalizeOptionalString(input.album)
      : input.album === null
        ? null
        : null;
  const albumArtist =
    typeof input.albumArtist === 'string'
      ? normalizeOptionalString(input.albumArtist)
      : input.albumArtist === null
        ? null
        : null;
  const trackNo =
    typeof input.trackNo === 'number' && Number.isInteger(input.trackNo) && input.trackNo > 0
      ? input.trackNo
      : input.trackNo === null
        ? null
        : null;
  const year =
    typeof input.year === 'number' &&
    Number.isInteger(input.year) &&
    input.year > 0 &&
    input.year <= 9999
      ? input.year
      : input.year === null
        ? null
        : null;
  const genres = Array.isArray(input.genres)
    ? normalizeGenres(input.genres.filter((g): g is string => typeof g === 'string'))
    : [];
  const rating =
    typeof input.rating === 'number' && Number.isInteger(input.rating)
      ? clampRating(input.rating)
      : 0;

  return {
    title,
    artist,
    album,
    albumArtist,
    trackNo,
    year,
    genres,
    rating,
    musicbrainzArtistId: normalizeMbid(input.musicbrainzArtistId),
    musicbrainzRecordingId: normalizeMbid(input.musicbrainzRecordingId),
    musicbrainzReleaseId: normalizeMbid(input.musicbrainzReleaseId),
    isrc: normalizeIsrc(input.isrc),
  };
}

export function metadataEquals(
  a: EditableTrackMetadata,
  b: EditableTrackMetadata,
): boolean {
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.albumArtist === b.albumArtist &&
    a.trackNo === b.trackNo &&
    a.year === b.year &&
    a.rating === b.rating &&
    a.musicbrainzArtistId === b.musicbrainzArtistId &&
    a.musicbrainzRecordingId === b.musicbrainzRecordingId &&
    a.musicbrainzReleaseId === b.musicbrainzReleaseId &&
    a.isrc === b.isrc &&
    a.genres.length === b.genres.length &&
    a.genres.every((genre, index) => genre === b.genres[index])
  );
}

export function parseGenresInput(raw: string): string[] {
  return normalizeGenres(raw.split(','));
}
