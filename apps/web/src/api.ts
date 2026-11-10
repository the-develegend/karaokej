import {
  AppSettingsDto,
  ArtistBioChooseDto,
  ArtistBioDto,
  DEFAULT_RATING_BLUE,
  DEFAULT_RATING_GOLD,
  DEFAULT_RATING_RASPBERRY,
  DEFAULT_RATING_SILVER,
  KaraokeMode,
  KaraokeSettingsDto,
  KaraokeStateDto,
  KaraokeTrackSettings,
  LibraryRebaseResultDto,
  LibraryScanBodyDto,
  LibrarySort,
  LibraryStatusDto,
  LyricSearchResultDto,
  LyricsDto,
  PlaylistDetailDto,
  PlaylistQueueMode,
  PlaylistSummaryDto,
  QueueItemDto,
  RandomArtistDto,
  SessionStateDto,
  ToolCheckResultDto,
  ToolId,
  ToolPathsStatusDto,
  ImportTagsResultDto,
  ManagedTagDto,
  TagListDto,
  TagMutationResultDto,
  TagRenameResultDto,
  TrackDto,
  TrackMetadataDto,
  TrackTagStateDto,
  UnmanagedTagsDto,
  TrackMetadataUpdateDto,
  TrackMoveExecuteDto,
  TrackMovePreviewDto,
  TrackPageDto,
  TrackPathDto,
  YoutubeDownloadResultDto,
  YoutubeSearchResultDto,
  defaultKaraokeState,
  defaultMetadataProvidersSettings,
  MetadataProviderId,
  MetadataProviderTestResultDto,
  MetadataSearchProviderId,
  MetadataSearchRequestDto,
  MetadataSearchResponseDto,
} from '@karaokej/shared';

/** Empty in browser/dev (same-origin / Vite proxy); set in Electron after IPC. */
let apiBaseUrl = '';

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

/**
 * Resolve the API origin before any requests. In Electron, waits for the
 * main process to report the ephemeral localhost port; elsewhere keeps
 * relative same-origin URLs.
 */
export async function initApiClient(): Promise<void> {
  const desktop = window.karaokejDesktop;
  if (desktop?.getApiBaseUrl) {
    apiBaseUrl = (await desktop.getApiBaseUrl()).replace(/\/$/, '');
  }
}

function resolveUrl(path: string): string {
  if (!apiBaseUrl) {
    return path;
  }
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(resolveUrl(path), {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    let body: unknown = null;
    let detail = response.statusText;
    try {
      body = await response.json();
      if (body && typeof body === 'object' && 'message' in body) {
        const message = (body as { message: unknown }).message;
        if (typeof message === 'string') {
          detail = message;
        } else if (Array.isArray(message)) {
          detail = message.join(', ');
        }
      }
    } catch {
      /* ignore */
    }
    throw new ApiError(detail, response.status, body);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  const text = await response.text();
  if (!text.trim()) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
}

export const api = {
  libraryStatus: () => request<LibraryStatusDto>('/api/library/status'),
  libraryRebase: () =>
    request<LibraryRebaseResultDto>('/api/library/rebase', { method: 'POST' }),
  randomArtist: (exclude?: string) => {
    const params = new URLSearchParams();
    if (exclude?.trim()) {
      params.set('exclude', exclude.trim());
    }
    const query = params.toString();
    return request<RandomArtistDto>(
      `/api/library/artists/random${query ? `?${query}` : ''}`,
    );
  },
  scan: (body: LibraryScanBodyDto = {}) =>
    request<LibraryStatusDto>('/api/library/scan', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelScan: () =>
    request<LibraryStatusDto>('/api/library/scan/cancel', { method: 'POST' }),
  refreshScan: () =>
    request<LibraryStatusDto>('/api/library/scan/refresh', { method: 'POST' }),
  fetchLyrics: () =>
    request<LibraryStatusDto>('/api/library/fetch-lyrics', { method: 'POST' }),
  cancelFetchLyrics: () =>
    request<LibraryStatusDto>('/api/library/fetch-lyrics/cancel', {
      method: 'POST',
    }),
  createThumbnails: () =>
    request<LibraryStatusDto>('/api/library/covers', { method: 'POST' }),
  cancelThumbnails: () =>
    request<LibraryStatusDto>('/api/library/covers/cancel', { method: 'POST' }),
  fetchTrackLyrics: (trackId: number) =>
    request<TrackDto>(`/api/tracks/${trackId}/lyrics/fetch`, { method: 'POST' }),
  searchTrackLyrics: (trackId: number, q: string) => {
    const params = new URLSearchParams({ q });
    return request<LyricSearchResultDto>(
      `/api/tracks/${trackId}/lyrics/search?${params.toString()}`,
    );
  },
  applyTrackLyrics: (trackId: number, lrclibId: number) =>
    request<TrackDto>(`/api/tracks/${trackId}/lyrics/apply`, {
      method: 'POST',
      body: JSON.stringify({ lrclibId }),
    }),
  markLyricsUnavailable: (trackId: number) =>
    request<TrackDto>(`/api/tracks/${trackId}/lyrics/unavailable`, {
      method: 'POST',
    }),
  trackArtistBio: (trackId: number) =>
    request<ArtistBioDto>(`/api/tracks/${trackId}/artist-bio`),
  chooseTrackArtistBio: (trackId: number, body: ArtistBioChooseDto) =>
    request<ArtistBioDto>(`/api/tracks/${trackId}/artist-bio/choose`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  refreshTrackArtistBio: (trackId: number) =>
    request<ArtistBioDto>(`/api/tracks/${trackId}/artist-bio/refresh`, {
      method: 'POST',
    }),
  trackArtistBioExtras: (trackId: number) =>
    request<ArtistBioDto>(`/api/tracks/${trackId}/artist-bio/extras`),
  tracks: (
    q: string,
    page: number,
    limit = 15,
    minRating = 0,
    hideDuplicates = false,
    tagNames: string[] = [],
    sort: LibrarySort = 'relevance',
  ) => {
    const params = new URLSearchParams({
      q,
      page: String(page),
      limit: String(limit),
      sort,
    });
    if (minRating > 0) {
      params.set('minRating', String(minRating));
    }
    if (hideDuplicates) {
      params.set('hideDuplicates', '1');
    }
    for (const tag of tagNames) {
      params.append('tags', tag);
    }
    return request<TrackPageDto>(`/api/tracks?${params}`);
  },
  orderedTrackIds: (
    q: string,
    minRating = 0,
    hideDuplicates = false,
    tagNames: string[] = [],
    sort: LibrarySort = 'relevance',
  ) => {
    const params = new URLSearchParams({ q, orderedIds: '1', sort });
    if (minRating > 0) {
      params.set('minRating', String(minRating));
    }
    if (hideDuplicates) {
      params.set('hideDuplicates', '1');
    }
    for (const tag of tagNames) {
      params.append('tags', tag);
    }
    return request<{ ids: number[] }>(`/api/tracks?${params}`);
  },
  addTracksToQueue: (
    trackIds: number[],
    placement: 'end' | 'after_current' = 'end',
    beforeId?: number | null,
  ) =>
    request<QueueItemDto[]>('/api/queue', {
      method: 'POST',
      body: JSON.stringify({
        trackIds,
        placement,
        ...(beforeId != null ? { beforeId } : {}),
      }),
    }),
  tags: () => request<TagListDto>('/api/tags'),
  createTag: (name: string) =>
    request<ManagedTagDto>('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  renameTag: async (id: number, name: string, merge: boolean) => {
    const response = await fetch(resolveUrl(`/api/tags/${id}/rename`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, merge }),
    });
    const body = (await response.json()) as TagRenameResultDto & { message?: string };
    if (!response.ok) {
      throw new Error(body.message ?? response.statusText);
    }
    return body;
  },
  deleteTag: (id: number) =>
    request<TagMutationResultDto>(`/api/tags/${id}`, { method: 'DELETE' }),
  unmanagedTags: () => request<UnmanagedTagsDto>('/api/tags/unmanaged'),
  importTags: (names: string[]) =>
    request<ImportTagsResultDto>('/api/tags/import', {
      method: 'POST',
      body: JSON.stringify({ names }),
    }),
  trackTags: (trackId: number) =>
    request<TrackTagStateDto>(`/api/tracks/${trackId}/tags`),
  assignTrackTags: (trackId: number, names: string[]) =>
    request<TrackDto>(`/api/tracks/${trackId}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ names }),
    }),
  setTrackRating: (trackId: number, rating: number) =>
    request<TrackDto>(`/api/tracks/${trackId}/rating`, {
      method: 'PUT',
      body: JSON.stringify({ rating }),
    }),
  searchTrackMetadata: (
    trackId: number,
    body: MetadataSearchRequestDto,
  ) =>
    request<MetadataSearchResponseDto>(`/api/tracks/${trackId}/metadata/search`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  testMetadataProvider: (providerId: MetadataProviderId) =>
    request<MetadataProviderTestResultDto>(
      `/api/settings/metadata-providers/${providerId}/test`,
      { method: 'POST' },
    ),
  readTrackMetadata: (trackId: number) =>
    request<TrackMetadataDto>(`/api/tracks/${trackId}/metadata`),
  updateTrackMetadata: (trackId: number, metadata: TrackMetadataUpdateDto) =>
    request<TrackDto>(`/api/tracks/${trackId}/metadata`, {
      method: 'PUT',
      body: JSON.stringify(metadata),
    }),
  previewTrackMove: (trackId: number) =>
    request<TrackMovePreviewDto>(`/api/tracks/${trackId}/move/preview`, {
      method: 'POST',
    }),
  executeTrackMove: (trackId: number, body: TrackMoveExecuteDto = {}) =>
    request<TrackDto>(`/api/tracks/${trackId}/move`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  trackPath: (trackId: number) =>
    request<TrackPathDto>(`/api/tracks/${trackId}/path`),
  deleteTrack: (trackId: number) =>
    request<void>(`/api/tracks/${trackId}`, { method: 'DELETE' }),
  lyrics: (trackId: number) => request<LyricsDto>(`/api/tracks/${trackId}/lyrics`),
  addToQueue: (
    trackId: number,
    placement: 'end' | 'after_current' = 'end',
    beforeId?: number | null,
  ) =>
    request<QueueItemDto[]>('/api/queue', {
      method: 'POST',
      body: JSON.stringify({
        trackId,
        placement,
        ...(beforeId != null ? { beforeId } : {}),
      }),
    }),
  playTrackNow: async (trackId: number): Promise<QueueItemDto | null> => {
    const queue = await request<QueueItemDto[]>('/api/queue', {
      method: 'POST',
      body: JSON.stringify({ trackId }),
    });
    const added = queue.at(-1) ?? null;
    if (added) {
      await request('/api/playback/play-item', {
        method: 'POST',
        body: JSON.stringify({ queueItemId: added.id }),
      });
    }
    return added;
  },
  /** Queue all tracks, then start playback on the first added item. */
  playTracksNow: async (trackIds: number[]): Promise<QueueItemDto | null> => {
    if (trackIds.length === 0) {
      return null;
    }
    const [firstId, ...rest] = trackIds;
    const first = await api.playTrackNow(firstId!);
    if (rest.length > 0) {
      await api.addTracksToQueue(rest, 'after_current');
    }
    return first;
  },
  removeFromQueue: (id: number) =>
    request(`/api/queue/${id}`, { method: 'DELETE' }),
  clearQueue: (mode: 'all' | 'except_current' | 'before_current' = 'all') => {
    const query =
      mode === 'all' ? '' : `?mode=${encodeURIComponent(mode)}`;
    return request<QueueItemDto[]>(`/api/queue${query}`, { method: 'DELETE' });
  },
  reorderQueue: (ids: number[]) =>
    request('/api/queue/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    }),
  shuffleQueue: () =>
    request<QueueItemDto[]>('/api/queue/shuffle', { method: 'POST' }),
  play: () => request('/api/playback/play', { method: 'POST' }),
  pause: () => request('/api/playback/pause', { method: 'POST' }),
  seek: (positionMs: number) =>
    request('/api/playback/seek', {
      method: 'POST',
      body: JSON.stringify({ positionMs }),
    }),
  volume: (volume: number) =>
    request('/api/playback/volume', {
      method: 'POST',
      body: JSON.stringify({ volume }),
    }),
  skip: () => request('/api/playback/skip', { method: 'POST' }),
  setLoopQueue: (enabled: boolean) =>
    request('/api/playback/loop', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  ended: (clientId: string) =>
    request('/api/playback/ended', {
      method: 'POST',
      body: JSON.stringify({ clientId }),
    }),
  checkpoint: (positionMs: number, clientId: string) =>
    request('/api/playback/checkpoint', {
      method: 'POST',
      body: JSON.stringify({ positionMs, clientId }),
    }),
  playItem: (queueItemId: number) =>
    request('/api/playback/play-item', {
      method: 'POST',
      body: JSON.stringify({ queueItemId }),
    }),
  claim: (clientId: string) =>
    request('/api/playback/claim', {
      method: 'POST',
      body: JSON.stringify({ clientId }),
    }),
  session: () => request<SessionStateDto>('/api/session'),
  getSettings: () => request<AppSettingsDto>('/api/settings'),
  patchSettings: (partial: Partial<AppSettingsDto>) =>
    request<AppSettingsDto>('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(partial),
    }),
  toolPathsStatus: () => request<ToolPathsStatusDto>('/api/settings/tools'),
  checkTool: (tool: ToolId) =>
    request<ToolCheckResultDto>('/api/settings/tools/check', {
      method: 'POST',
      body: JSON.stringify({ tool }),
    }),
  playlists: () => request<PlaylistSummaryDto[]>('/api/playlists'),
  playlist: (id: number) => request<PlaylistDetailDto>(`/api/playlists/${id}`),
  createPlaylist: (name: string, description?: string | null) =>
    request<PlaylistDetailDto>('/api/playlists', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  updatePlaylist: (
    id: number,
    patch: { name?: string; description?: string | null },
  ) =>
    request<PlaylistDetailDto>(`/api/playlists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deletePlaylist: (id: number) =>
    request<void>(`/api/playlists/${id}`, { method: 'DELETE' }),
  addToPlaylist: (
    playlistId: number,
    trackId: number,
    beforeItemId?: number | null,
  ) =>
    request<PlaylistDetailDto>(`/api/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({
        trackId,
        ...(beforeItemId != null ? { beforeItemId } : {}),
      }),
    }),
  addTracksToPlaylist: (
    playlistId: number,
    trackIds: number[],
    beforeItemId?: number | null,
  ) =>
    request<PlaylistDetailDto>(`/api/playlists/${playlistId}/items`, {
      method: 'POST',
      body: JSON.stringify({
        trackIds,
        ...(beforeItemId != null ? { beforeItemId } : {}),
      }),
    }),
  removeFromPlaylist: (playlistId: number, itemId: number) =>
    request<PlaylistDetailDto>(`/api/playlists/${playlistId}/items/${itemId}`, {
      method: 'DELETE',
    }),
  reorderPlaylistItems: (playlistId: number, ids: number[]) =>
    request<PlaylistDetailDto>(`/api/playlists/${playlistId}/items/reorder`, {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    }),
  loadPlaylistIntoQueue: (playlistId: number, mode: PlaylistQueueMode) =>
    request<QueueItemDto[]>(`/api/playlists/${playlistId}/queue`, {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),
  launchYtsaver: () =>
    request<{ ok: true }>('/api/external/ytsaver/launch', { method: 'POST' }),
  searchYoutube: (q: string) => {
    const params = new URLSearchParams({ q });
    return request<YoutubeSearchResultDto>(
      `/api/external/youtube/search?${params.toString()}`,
    );
  },
  downloadYoutube: (videoId: string) =>
    request<YoutubeDownloadResultDto>('/api/external/youtube/download', {
      method: 'POST',
      body: JSON.stringify({ videoId }),
    }),
  getKaraokeSettings: (trackId: number) =>
    request<KaraokeSettingsDto>(`/api/tracks/${trackId}/karaoke-settings`),
  saveKaraokeSettings: (trackId: number, settings: KaraokeTrackSettings) =>
    request<KaraokeSettingsDto>(`/api/tracks/${trackId}/karaoke-settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
  resetKaraokeSettings: (trackId: number) =>
    request<KaraokeSettingsDto>(`/api/tracks/${trackId}/karaoke-settings`, {
      method: 'DELETE',
    }),
  setKaraokeMode: (mode: KaraokeMode) =>
    request<KaraokeStateDto>('/api/karaoke/mode', {
      method: 'PUT',
      body: JSON.stringify({ mode }),
    }),
  patchKaraokeLive: (patch: Partial<KaraokeTrackSettings> & { trackId?: number }) =>
    request<KaraokeStateDto>('/api/karaoke/live', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  getKaraokeState: () => request<KaraokeStateDto>('/api/karaoke/state'),
  separateTrack: (trackId: number) =>
    request<KaraokeStateDto>(`/api/karaoke/tracks/${trackId}/separate`, {
      method: 'POST',
    }),
  cancelSeparation: () =>
    request<KaraokeStateDto>('/api/karaoke/separation', { method: 'DELETE' }),
  removeKaraokeStem: (trackId: number) =>
    request<KaraokeStateDto>(`/api/karaoke/tracks/${trackId}/stem`, {
      method: 'DELETE',
    }),
};

export function wsUrl(): string {
  if (apiBaseUrl) {
    const url = new URL(apiBaseUrl);
    const proto = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${url.host}/ws`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
}

export const emptySession: SessionStateDto = {
  playback: {
    currentQueueItemId: null,
    currentTrack: null,
    status: 'idle',
    positionMs: 0,
    volume: 1,
    playerClientId: null,
    seekSeq: 0,
    loopQueue: false,
  },
  queue: [],
  jobs: {
    scan: { kind: 'scan', running: false, current: 0, total: 0, message: null },
    lyricsFetch: {
      kind: 'lyrics',
      running: false,
      current: 0,
      total: 0,
      message: null,
    },
    download: {
      kind: 'download',
      running: false,
      current: 0,
      total: 0,
      message: null,
    },
    separation: {
      kind: 'separation',
      running: false,
      current: 0,
      total: 0,
      message: null,
    },
    covers: {
      kind: 'covers',
      running: false,
      current: 0,
      total: 0,
      message: null,
    },
  },
  settings: {
    metadataProviders: defaultMetadataProvidersSettings(),
    removePlayedFromQueue: false,
    crossfadeSeconds: 0,
    crossfadePrefSeconds: 5,
    ratingGold: DEFAULT_RATING_GOLD,
    ratingSilver: DEFAULT_RATING_SILVER,
    ratingBlue: DEFAULT_RATING_BLUE,
    ratingRaspberry: DEFAULT_RATING_RASPBERRY,
    ytdlpPath: '',
    ffmpegPath: '',
    ffprobePath: '',
    ytdlpNodePath: '',
    ytsaverPath: '',
    demucsPath: '',
    libraryPaths: [],
    mainLibraryPath: null,
  },
  karaoke: defaultKaraokeState(),
};
