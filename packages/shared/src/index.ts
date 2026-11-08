export type AudioFormat = 'mp3' | 'flac' | 'opus';

import type { AiProcessingStatus, KaraokeStateDto } from './karaoke';

export type LyricStatus =
  | 'missing'
  | 'present'
  | 'instrumental'
  | 'not_found'
  | 'unavailable'
  | 'error';

export type LyricSource = 'local' | 'lrclib';

export type MetadataStatus = 'pending' | 'ready';

/** pending = never looked at; none = looked, no artwork exists. */
export type CoverStatus = 'pending' | 'ready' | 'none' | 'error';

export type CoverSize = 'sm' | 'lg';

export interface TrackDto {
  id: number;
  relativePath: string;
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  durationMs: number | null;
  format: AudioFormat;
  lyricStatus: LyricStatus;
  lyricSource: LyricSource | null;
  /** Cached 0–10 half-star units. Null if the cache has not been populated yet. */
  rating: number | null;
  year: number | null;
  genres: string[];
  /** pending = path-only metadata; ready = tags parsed from file headers */
  metadataStatus: MetadataStatus;
  /**
   * Changes when a tag write moved the audio frames, which invalidates cached byte
   * ranges. Used to version the audio URL so the player reloads only then.
   */
  audioVersion: number;
  /** Stem separation state; null = never requested / no row in karaoke_stems. */
  karaokeStemStatus: AiProcessingStatus | null;
  /** Album-level artwork key; every track of one album shares it. */
  coverGroup: string | null;
  /** Content hash of the resolved artwork, used to pin immutable caching. */
  coverVersion: string | null;
  coverStatus: CoverStatus;
  /** MusicBrainz artist ID from file tags, when present. */
  musicbrainzArtistId: string | null;
  /** Managed mood names on this song, alphabetical. */
  tags: string[];
}

export interface TrackPageDto {
  items: TrackDto[];
  total: number;
  page: number;
  limit: number;
}

/** How library search results are ordered. */
export const LIBRARY_SORTS = ['relevance', 'album', 'artist', 'title'] as const;

export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export function parseLibrarySort(value: string | null | undefined): LibrarySort {
  if (value && (LIBRARY_SORTS as readonly string[]).includes(value)) {
    return value as LibrarySort;
  }
  return 'relevance';
}

export interface TrackPathDto {
  path: string;
}

export interface TrackMetadataDto {
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  year: number | null;
  genres: string[];
  rating: number;
  durationMs: number | null;
  format: AudioFormat;
  musicbrainzArtistId: string | null;
  musicbrainzRecordingId: string | null;
  musicbrainzReleaseId: string | null;
  isrc: string | null;
}

export interface TrackMetadataUpdateDto {
  title: string;
  artist?: string | null;
  album?: string | null;
  albumArtist?: string | null;
  trackNo?: number | null;
  year?: number | null;
  genres?: string[];
  rating?: number;
  musicbrainzArtistId?: string | null;
  musicbrainzRecordingId?: string | null;
  musicbrainzReleaseId?: string | null;
  isrc?: string | null;
}

export const METADATA_SEARCH_PROVIDER_IDS = [
  'musicbrainz',
  'discogs',
  'lastfm',
  'gnudb',
  'spotify',
] as const;

export const METADATA_SETTINGS_PROVIDER_IDS = [
  ...METADATA_SEARCH_PROVIDER_IDS,
  'acoustid',
] as const;

export type MetadataSearchProviderId =
  (typeof METADATA_SEARCH_PROVIDER_IDS)[number];

export type MetadataProviderId = (typeof METADATA_SETTINGS_PROVIDER_IDS)[number];

export const DEFAULT_METADATA_PROVIDER_ORDER: MetadataProviderId[] = [
  'musicbrainz',
  'discogs',
  'lastfm',
  'gnudb',
  'spotify',
  'acoustid',
];

export function defaultMetadataProvidersSettings(): MetadataProvidersSettingsDto {
  return {
    order: [...DEFAULT_METADATA_PROVIDER_ORDER],
    musicbrainz: { enabled: false, contactEmail: '' },
    discogs: { enabled: false, token: '', tokenSaved: false },
    lastfm: { enabled: false, apiKey: '', apiKeySaved: false },
    gnudb: { enabled: false, contactEmail: '' },
    spotify: {
      enabled: false,
      clientId: '',
      clientSecret: '',
      clientSecretSaved: false,
    },
    acoustid: { enabled: false, apiKey: '', apiKeySaved: false },
  };
}

export interface MetadataProviderMusicBrainzConfigDto {
  enabled: boolean;
  contactEmail: string;
}

export interface MetadataProviderDiscogsConfigDto {
  enabled: boolean;
  /** Empty when masked on GET; omit or leave empty on PATCH to keep saved token. */
  token: string;
  tokenSaved: boolean;
}

export interface MetadataProviderLastFmConfigDto {
  enabled: boolean;
  apiKey: string;
  apiKeySaved: boolean;
}

export interface MetadataProviderGnuDbConfigDto {
  enabled: boolean;
  contactEmail: string;
}

export interface MetadataProviderSpotifyConfigDto {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  clientSecretSaved: boolean;
}

export interface MetadataProviderAcoustIdConfigDto {
  enabled: boolean;
  apiKey: string;
  apiKeySaved: boolean;
}

export interface MetadataProvidersSettingsDto {
  order: MetadataProviderId[];
  musicbrainz: MetadataProviderMusicBrainzConfigDto;
  discogs: MetadataProviderDiscogsConfigDto;
  lastfm: MetadataProviderLastFmConfigDto;
  gnudb: MetadataProviderGnuDbConfigDto;
  spotify: MetadataProviderSpotifyConfigDto;
  acoustid: MetadataProviderAcoustIdConfigDto;
}

export type MetadataProviderTriedStatus =
  | 'skipped'
  | 'no_results'
  | 'ok'
  | 'error';

export interface MetadataProviderTriedDto {
  id: MetadataSearchProviderId;
  label: string;
  status: MetadataProviderTriedStatus;
  message?: string;
}

export interface MetadataSearchHitDto {
  providerId: MetadataSearchProviderId;
  providerLabel: string;
  externalUrl: string | null;
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  year: number | null;
  genres: string[];
  musicbrainzArtistId: string | null;
  musicbrainzRecordingId: string | null;
  musicbrainzReleaseId: string | null;
  isrc: string | null;
}

export interface MetadataSearchRequestDto {
  query?: string;
  providerIds?: MetadataSearchProviderId[];
}

export interface MetadataSearchResponseDto {
  hits: MetadataSearchHitDto[];
  triedProviders: MetadataProviderTriedDto[];
  queryUsed: string;
}

export interface MetadataProviderTestResultDto {
  ok: boolean;
  message: string;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsDto {
  available: boolean;
  lines: LyricLine[];
}

export interface LyricSearchHitDto {
  id: number;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
}

export interface LyricSearchResultDto {
  query: string;
  hits: LyricSearchHitDto[];
}

export interface QueueItemDto {
  id: number;
  position: number;
  addedAt: string;
  track: TrackDto;
  /** AI separation status for this track, when present in the catalogue. */
  stem: { status: AiProcessingStatus } | null;
}

export type PlaybackStatus = 'idle' | 'playing' | 'paused';

export interface PlaybackStateDto {
  currentQueueItemId: number | null;
  currentTrack: TrackDto | null;
  status: PlaybackStatus;
  positionMs: number;
  volume: number;
  playerClientId: string | null;
  seekSeq: number;
  loopQueue: boolean;
}

export type JobKind = 'scan' | 'lyrics' | 'download' | 'separation' | 'covers';

export interface JobStatusDto {
  kind: JobKind;
  running: boolean;
  current: number;
  total: number;
  message: string | null;
  /** Track being separated, when kind is separation and a job is active. */
  trackId?: number | null;
}

export interface ScanIssueDto {
  path: string;
  op: 'readdir' | 'stat' | 'exists' | 'parse';
  message: string;
}

export interface InvalidLibraryPathDto {
  path: string;
  reason: string;
}

export interface LibraryScanBodyDto {
  acknowledgeInvalidRoots?: boolean;
}

export interface LibraryRebaseResultDto {
  message: string;
  libraryStatus: LibraryStatusDto;
}

export interface LibraryStatusDto {
  trackCount: number;
  withLyrics: number;
  libraryPaths: string[];
  libraryConfigured: boolean;
  rebasePending: boolean;
  invalidLibraryPaths: InvalidLibraryPathDto[];
  lastFullScanAt: number | null;
  scanIssues: ScanIssueDto[];
  scan: JobStatusDto;
  lyricsFetch: JobStatusDto;
  ytsaverAvailable: boolean;
  ytsaverPath: string;
  ytdlpAvailable: boolean;
  ytdlpPath: string;
  demucsAvailable: boolean;
  demucsPath: string;
}

export interface YoutubeSearchHitDto {
  id: string;
  title: string;
  uploader: string | null;
  durationMs: number | null;
}

export interface YoutubeSearchResultDto {
  query: string;
  hits: YoutubeSearchHitDto[];
}

export interface YoutubeDownloadResultDto {
  track: TrackDto;
}

export { buildPlatformSearchUrls, type PlatformSearchUrls } from './search-fallback-urls';

export {
  KARAOKE_DEFAULTS,
  KARAOKE_DEFAULT_EQ_BANDS,
  KARAOKE_LIMITS,
  KARAOKE_MODES,
  defaultKaraokeState,
  isAiProcessingStatus,
  isKaraokeMode,
  karaokeTrackSettingsEqual,
  normalizeKaraokeSettings,
  parseEqBands,
  serializeEqBands,
  type AiProcessingStatus,
  type KaraokeEqBand,
  type KaraokeMode,
  type KaraokeSettingsDto,
  type KaraokeStateDto,
  type KaraokeStemDto,
  type KaraokeTrackSettings,
  type NormalizeKaraokeSettingsResult,
} from './karaoke';

export interface RandomArtistDto {
  artist: string;
}

export type ArtistBioStatus = 'ready' | 'not_found' | 'ambiguous' | 'no_artist';

export interface ArtistBioChoiceDto {
  audiodbId: string | null;
  name: string;
  country: string | null;
  genre: string | null;
  formedYear: string | null;
}

export interface ArtistBioAlbumDto {
  name: string;
  year: string | null;
}

export interface ArtistBioTrackDto {
  name: string;
}

export interface ArtistBioDto {
  status: ArtistBioStatus;
  displayName: string | null;
  biography: string | null;
  genre: string | null;
  style: string | null;
  mood: string | null;
  country: string | null;
  formedYear: string | null;
  albums: ArtistBioAlbumDto[];
  topTracks: ArtistBioTrackDto[];
  choices: ArtistBioChoiceDto[];
}

export interface ArtistBioChooseDto {
  name?: string;
  audiodbId?: string;
}

export const DEFAULT_RATING_GOLD = '#ffe08a';
export const DEFAULT_RATING_SILVER = '#c8d0dc';
export const DEFAULT_RATING_BLUE = '#3b82f6';
export const DEFAULT_RATING_RASPBERRY = '#e11d74';

export const TOOL_IDS = [
  'ffmpeg',
  'ffprobe',
  'ytdlp',
  'node',
  'demucs',
  'ytsaver',
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

export interface ToolCheckResultDto {
  version: string | null;
  message: string;
}

export interface ToolPathStatusDto {
  id: ToolId;
  effectivePath: string;
  available: boolean;
}

export interface ToolPathsStatusDto {
  tools: ToolPathStatusDto[];
}

export interface AppSettingsDto {
  metadataProviders: MetadataProvidersSettingsDto;
  removePlayedFromQueue: boolean;
  /** 0 = off, 1–10 = crossfade duration in seconds */
  crossfadeSeconds: number;
  /** Last non-zero crossfade duration used when toggling back on from the player bar */
  crossfadePrefSeconds: number;
  ratingGold: string;
  ratingSilver: string;
  ratingBlue: string;
  ratingRaspberry: string;
  /** Empty string = use .env then built-in default */
  ytdlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  ytdlpNodePath: string;
  ytsaverPath: string;
  demucsPath: string;
  /** Music library roots as entered on Settings (empty = none configured). */
  libraryPaths: string[];
  /** Catalogue root used when organizing files (must be one of libraryPaths). */
  mainLibraryPath: string | null;
}

export interface TrackMovePreviewDto {
  fromAbsolute: string;
  toAbsolute: string;
  conflict: boolean;
  sidecars: string[];
}

export interface TrackMoveExecuteDto {
  removeEmptyDirs?: boolean;
}

export interface SessionStateDto {
  playback: PlaybackStateDto;
  queue: QueueItemDto[];
  jobs: {
    scan: JobStatusDto;
    lyricsFetch: JobStatusDto;
    download: JobStatusDto;
    separation: JobStatusDto;
    covers: JobStatusDto;
  };
  settings: AppSettingsDto;
  karaoke: KaraokeStateDto;
}

export interface WsClientMessage {
  type: 'hello';
  clientId: string;
}

export interface WsServerMessage {
  type: 'session';
  state: SessionStateDto;
}

export interface PlaylistSummaryDto {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  itemCount: number;
  /** Sum of known track durations in milliseconds. */
  totalDurationMs: number;
  /** Listed tracks with no duration yet. */
  unknownDurationCount: number;
}

export interface PlaylistItemDto {
  id: number;
  position: number;
  addedAt: string;
  available: boolean;
  track: TrackDto;
}

export interface PlaylistDetailDto {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  items: PlaylistItemDto[];
}

export type PlaylistQueueMode = 'append' | 'replace';

export interface ManagedTagDto {
  id: number;
  name: string;
  songCount: number;
}

export interface TagListDto {
  tags: ManagedTagDto[];
}

export interface TrackTagStateDto {
  /** Managed names currently on the song. */
  managed: string[];
  /** Valid mood names on the file that are not in the managed list. */
  embedded: string[];
  /** Mood values that are not valid tag names and still occupy a slot. */
  extraCount: number;
}

export interface TagFileFailureDto {
  trackId: number;
  path: string;
  message: string;
}

export interface TagMutationResultDto {
  tag: ManagedTagDto | null;
  failures: TagFileFailureDto[];
}

export interface TagRenameResultDto {
  conflict: boolean;
  existingName?: string;
  songCount?: number;
  result?: TagMutationResultDto;
}

export interface UnmanagedTagsDto {
  names: string[];
}

export interface ImportTagsResultDto {
  imported: string[];
  skipped: string[];
}

export {
  MAX_MANAGED_TAGS,
  MAX_TAG_NAME_LENGTH,
  MAX_TAGS_PER_SONG,
  parseTagName,
  tagKey,
  tagNameError,
} from './tag-names';
export type { ParsedTagName } from './tag-names';
