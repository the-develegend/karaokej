import {
  AiProcessingStatus,
  AudioFormat,
  CoverStatus,
  JobKind,
  KARAOKE_DEFAULTS,
  KaraokeSettingsDto,
  KaraokeStemDto,
  KaraokeTrackSettings,
  LibraryPlacement,
  LyricSource,
  LyricStatus,
  TrackDto,
  parseEqBands,
} from '@karaokej/shared';

export interface TrackRow {
  id: number;
  relative_path: string;
  format: AudioFormat;
  size_bytes: number;
  mtime_ms: number;
  title: string;
  artist: string | null;
  album: string | null;
  album_artist: string | null;
  track_no: number | null;
  duration_ms: number | null;
  lyric_status: LyricStatus;
  lyric_source: LyricSource | null;
  lyric_checked_at: number | null;
  lrclib_id: number | null;
  fingerprint: string | null;
  rating: number | null;
  year: number | null;
  genres: string | null;
  metadata_status: 'pending' | 'ready';
  cover_group: string | null;
  musicbrainz_artist_id: string | null;
  mood_extra?: string | null;
  available: number;
  created_at: number;
  updated_at: number;
}

function parseGenres(raw: string | null | undefined): string[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((g): g is string => typeof g === 'string');
  } catch {
    return [];
  }
}

export interface TrackCoverInfo {
  status: CoverStatus;
  hash: string | null;
}

export function trackToDto(
  row: TrackRow,
  karaokeStemStatus: AiProcessingStatus | null = null,
  cover: TrackCoverInfo | null = null,
  tags: string[] = [],
  libraryPlacement: LibraryPlacement = 'organized',
): TrackDto {
  return {
    id: row.id,
    relativePath: row.relative_path,
    title: row.title,
    artist: row.artist,
    album: row.album,
    albumArtist: row.album_artist,
    trackNo: row.track_no,
    durationMs: row.duration_ms,
    format: row.format,
    lyricStatus: row.lyric_status,
    lyricSource: row.lyric_source,
    rating: row.rating,
    year: row.year,
    genres: parseGenres(row.genres),
    metadataStatus: row.metadata_status ?? 'ready',
    audioVersion: row.size_bytes,
    karaokeStemStatus,
    coverGroup: row.cover_group ?? null,
    coverVersion: cover?.hash ?? null,
    coverStatus: cover?.status ?? 'pending',
    musicbrainzArtistId: row.musicbrainz_artist_id ?? null,
    tags,
    libraryPlacement,
  };
}

export interface QueueRow {
  id: number;
  track_id: number;
  position: number;
  added_at: number;
}

export interface PlaybackRow {
  id: number;
  current_queue_item_id: number | null;
  status: 'idle' | 'playing' | 'paused';
  position_ms: number;
  volume: number;
  player_client_id: string | null;
  seek_seq: number;
  loop_queue: number;
  updated_at: number;
}

export type CoverGroupStatus = 'pending' | 'ready' | 'none' | 'error';

export type CoverSourceKind = 'sidecar' | 'embedded';

export interface CoverGroupRow {
  group_key: string;
  status: CoverGroupStatus;
  cover_hash: string | null;
  source_kind: CoverSourceKind | null;
  source_path: string | null;
  checked_at: number | null;
  error: string | null;
}

export interface CoverRow {
  hash: string;
  format: string;
  src_width: number | null;
  src_height: number | null;
  bytes_sm: number | null;
  bytes_lg: number | null;
  created_at: number;
}

export interface JobRow {
  kind: JobKind;
  running: number;
  current: number;
  total: number;
  message: string | null;
  updated_at: number;
}

export interface PlaylistRow {
  id: number;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
}

export interface PlaylistItemRow {
  id: number;
  playlist_id: number;
  track_id: number;
  position: number;
  added_at: number;
}

export interface KaraokeSettingsRow {
  track_id: number;
  center_amount: number;
  bass_retain_hz: number;
  treble_retain_hz: number;
  makeup_gain_db: number;
  eq_bands: string;
  created_at: number;
  updated_at: number;
}

export interface KaraokeStemRow {
  track_id: number;
  status: AiProcessingStatus;
  model: string | null;
  model_version: string | null;
  file_path: string | null;
  size_bytes: number | null;
  source_mtime_ms: number;
  source_size_bytes: number;
  error: string | null;
  requested_at: number | null;
  processed_at: number | null;
  created_at: number;
  updated_at: number;
}

export function karaokeStemToDto(
  trackId: number,
  row: KaraokeStemRow | null,
): KaraokeStemDto {
  if (!row) {
    return {
      trackId,
      status: 'none',
      url: null,
      model: null,
      modelVersion: null,
      processedAt: null,
      error: null,
    };
  }
  return {
    trackId,
    status: row.status,
    url:
      row.status === 'ready'
        ? `/api/tracks/${trackId}/karaoke-stem`
        : null,
    model: row.model,
    modelVersion: row.model_version,
    processedAt: row.processed_at
      ? new Date(row.processed_at).toISOString()
      : null,
    error: row.error,
  };
}

export function karaokeSettingsRowToTrackSettings(
  row: KaraokeSettingsRow,
): KaraokeTrackSettings {
  return {
    centerAmount: row.center_amount,
    bassRetainHz: row.bass_retain_hz,
    trebleRetainHz: row.treble_retain_hz,
    makeupGainDb: row.makeup_gain_db,
    eqBands: parseEqBands(JSON.parse(row.eq_bands)),
  };
}

export function karaokeSettingsToDto(
  trackId: number,
  row: KaraokeSettingsRow | null,
  isDefault: boolean,
): KaraokeSettingsDto {
  if (!row) {
    return {
      trackId,
      ...KARAOKE_DEFAULTS,
      eqBands: KARAOKE_DEFAULTS.eqBands.map((band) => ({ ...band })),
      isDefault: true,
      updatedAt: null,
    };
  }
  let eqBands;
  try {
    eqBands = parseEqBands(JSON.parse(row.eq_bands));
  } catch {
    eqBands = KARAOKE_DEFAULTS.eqBands.map((band) => ({ ...band }));
  }
  return {
    trackId,
    centerAmount: row.center_amount,
    bassRetainHz: row.bass_retain_hz,
    trebleRetainHz: row.treble_retain_hz,
    makeupGainDb: row.makeup_gain_db,
    eqBands,
    isDefault,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
