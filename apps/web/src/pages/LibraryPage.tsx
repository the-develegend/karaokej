import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FiChevronLeft,
  FiChevronRight,
  FiChevronsLeft,
  FiChevronsRight,
  FiPlay,
  FiPlus,
} from 'react-icons/fi';
import { LuDices, LuHistory } from 'react-icons/lu';
import {
  InvalidLibraryPathDto,
  LibrarySort,
  LibraryStatusDto,
  parseLibrarySort,
  PlaylistDetailDto,
  PlaylistQueueMode,
  PlaylistSummaryDto,
  ScanIssueDto,
  TrackDto,
} from '@karaokej/shared';
import { api, ApiError } from '../api';
import { DraggableTrackRow } from '../components/DraggableTrackRow';
import {
  activeFilterCount,
  filtersButtonLabel,
  LibraryFiltersDraft,
  LibraryFiltersModal,
} from '../components/LibraryFiltersModal';
import { ClearQueueModal } from '../components/ClearQueueModal';
import { CoverArtModal } from '../components/CoverArtModal';
import { Modal } from '../components/Modal';
import { AppTopbar } from '../components/AppTopbar';
import { PlayerBar } from '../components/PlayerBar';
import { PlayPlaylistModal } from '../components/PlayPlaylistModal';
import { PlayTrackModal } from '../components/PlayTrackModal';
import { ScanModal } from '../components/ScanModal';
import { ScanIssuesModal } from '../components/ScanIssuesModal';
import { LyricSearchModal } from '../components/LyricSearchModal';
import { TrackMetadataModal } from '../components/TrackMetadataModal';
import { TagImportModal } from '../components/TagImportModal';
import { TagPickerModal } from '../components/TagPickerModal';
import { SearchHistoryModal } from '../components/SearchHistoryModal';
import { SearchMissFallback } from '../components/SearchMissFallback';
import { WorkspaceDnd } from '../components/WorkspaceDnd';
import {
  PaneAccordionTrigger,
  paneAccordionClass,
  useWorkspaceAccordion,
} from '../components/WorkspaceAccordion';
import { addSearchHistoryTerm, clearSearchHistory, readSearchHistory } from '../searchHistory';
import { MODAL_IDS } from '../modals/dismissedModals';
import { useConfirmModal } from '../modals/useConfirmModal';
import { useSession } from '../session/SessionProvider';

const LIBRARY_SORT_KEY = 'karaokej.librarySort';

function readStoredSort(): LibrarySort {
  try {
    return parseLibrarySort(sessionStorage.getItem(LIBRARY_SORT_KEY));
  } catch {
    return 'relevance';
  }
}

export function LibraryPage() {
  const { state, isPlayer, clientId } = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const confirmModal = useConfirmModal();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<LibrarySort>(readStoredSort);
  const [inputValue, setInputValue] = useState('');
  const [searchHistory, setSearchHistory] = useState(() => readSearchHistory());
  const [historyOpen, setHistoryOpen] = useState(false);
  const skipHistoryRecordRef = useRef(false);
  const [page, setPage] = useState(1);
  const [fetchingIds, setFetchingIds] = useState<Set<number>>(new Set());
  const [tracks, setTracks] = useState<TrackDto[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<LibraryStatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minRating, setMinRating] = useState(0);
  const [hideDuplicates, setHideDuplicates] = useState(false);
  const [tagNames, setTagNames] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersDraft, setFiltersDraft] = useState<LibraryFiltersDraft>({
    minRating: 0,
    hideDuplicates: false,
    tags: [],
  });
  const [tagTrack, setTagTrack] = useState<TrackDto | null>(null);
  const [importTagNames, setImportTagNames] = useState<string[]>([]);
  const [playlistSummaries, setPlaylistSummaries] = useState<PlaylistSummaryDto[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<number | null>(null);
  const [playlistDetail, setPlaylistDetail] = useState<PlaylistDetailDto | null>(null);
  const [playModalPlaylistId, setPlayModalPlaylistId] = useState<number | null>(null);
  const [playModalTrack, setPlayModalTrack] = useState<TrackDto | null>(null);
  const [playModalPageTracks, setPlayModalPageTracks] = useState<TrackDto[] | null>(
    null,
  );
  const [revealQueueItemId, setRevealQueueItemId] = useState<number | null>(null);
  const clearRevealQueueItem = useCallback(() => {
    setRevealQueueItemId(null);
  }, []);
  const [clearQueueModalOpen, setClearQueueModalOpen] = useState(false);
  const [scanIssues, setScanIssues] = useState<ScanIssueDto[]>([]);
  const [scanIssuesOpen, setScanIssuesOpen] = useState(false);
  const [lyricSearchTrack, setLyricSearchTrack] = useState<TrackDto | null>(null);
  const [metadataTrack, setMetadataTrack] = useState<TrackDto | null>(null);
  const [removeStemTrack, setRemoveStemTrack] = useState<TrackDto | null>(null);
  const [deleteFileTrack, setDeleteFileTrack] = useState<TrackDto | null>(null);
  const [coverTrack, setCoverTrack] = useState<TrackDto | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanInvalidPaths, setScanInvalidPaths] = useState<
    InvalidLibraryPathDto[] | null
  >(null);
  const limit = 15;
  const [selectedTracks, setSelectedTracks] = useState<
    Array<{ track: TrackDto; rank: number }>
  >([]);

  const selectedTrackIds = useMemo(
    () => new Set(selectedTracks.map((entry) => entry.track.id)),
    [selectedTracks],
  );

  const orderedSelectedTrackIds = useMemo(
    () =>
      [...selectedTracks]
        .sort((a, b) => a.rank - b.rank)
        .map((entry) => entry.track.id),
    [selectedTracks],
  );

  const toggleTrackSelection = useCallback((track: TrackDto, rank: number) => {
    setSelectedTracks((prev) => {
      const index = prev.findIndex((entry) => entry.track.id === track.id);
      if (index >= 0) {
        return prev.filter((entry) => entry.track.id !== track.id);
      }
      return [...prev, { track, rank }];
    });
  }, []);

  const clearExplorerSelection = useCallback(() => {
    setSelectedTracks([]);
  }, []);

  useEffect(() => {
    if (selectedTracks.length === 0) {
      return;
    }
    void api
      .orderedTrackIds(query, minRating, hideDuplicates, tagNames, sort)
      .then(({ ids }) => {
        const idSet = new Set(ids);
        setSelectedTracks((prev) => {
          const byId = new Map(prev.map((entry) => [entry.track.id, entry]));
          return ids
            .filter((id) => byId.has(id))
            .map((id, index) => {
              const entry = byId.get(id)!;
              return { track: entry.track, rank: index };
            });
        });
      })
      .catch(() => {});
  }, [query, minRating, hideDuplicates, tagNames, sort]);

  useEffect(() => {
    if (searchParams.get('scan') !== '1') {
      return;
    }
    setScanOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('scan');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const loadTracks = async (
    q: string,
    p: number,
    rating = minRating,
    dedupe = hideDuplicates,
    tags = tagNames,
    librarySort = sort,
  ) => {
    try {
      const result = await api.tracks(q, p, limit, rating, dedupe, tags, librarySort);
      setTracks(result.items);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadStatus = async () => {
    try {
      setStatus(await api.libraryStatus());
    } catch {
      /* websocket will still show jobs */
    }
  };

  useEffect(() => {
    void loadTracks(query, page, minRating, hideDuplicates, tagNames, sort);
  }, [query, page, minRating, hideDuplicates, tagNames, sort]);

  const loadPlaylists = useCallback(async () => {
    try {
      const summaries = await api.playlists();
      setPlaylistSummaries(summaries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const loadPlaylistDetail = useCallback(async (id: number) => {
    try {
      const detail = await api.playlist(id);
      setPlaylistDetail(detail);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void loadPlaylists();
  }, [loadPlaylists]);

  useEffect(() => {
    if (selectedPlaylistId != null) {
      void loadPlaylistDetail(selectedPlaylistId);
    } else {
      setPlaylistDetail(null);
    }
  }, [selectedPlaylistId, loadPlaylistDetail]);

  const prevScanRunning = useRef(false);
  const prevScanProgress = useRef({ current: 0, message: '' as string | null });
  const prevSeparationRunning = useRef(false);

  useEffect(() => {
    if (prevSeparationRunning.current && !state.jobs.separation.running) {
      void loadTracks(query, page, minRating, hideDuplicates, tagNames);
    }
    prevSeparationRunning.current = state.jobs.separation.running;
  }, [state.jobs.separation.running, query, page, minRating, hideDuplicates, tagNames]);

  useEffect(() => {
    if (prevScanRunning.current && !state.jobs.scan.running) {
      void loadTracks(query, page, minRating, hideDuplicates, tagNames);
      if (selectedPlaylistId != null) {
        void loadPlaylistDetail(selectedPlaylistId);
      }
      const message = state.jobs.scan.message ?? '';
      const skipped =
        message.startsWith('Scan cancelled') ||
        message.startsWith('Scan interrupted') ||
        message.startsWith('Scan failed');
      if (!skipped) {
        void api.unmanagedTags().then((unmanaged) => {
          if (unmanaged.names.length > 0) {
            setImportTagNames(unmanaged.names);
          }
        }).catch(() => {
          /* the library list still reloads */
        });
      }
      void api.libraryStatus().then((next) => {
        setStatus(next);
        if (next.scanIssues.length > 0) {
          setScanIssues(next.scanIssues);
          setScanIssuesOpen(true);
        }
      }).catch(() => {
        /* status copy still updates from the existing effect */
      });
    }
    prevScanRunning.current = state.jobs.scan.running;
  }, [state.jobs.scan.running, query, page, minRating, hideDuplicates, tagNames, selectedPlaylistId, loadPlaylistDetail]);

  useEffect(() => {
    if (!state.jobs.scan.running) {
      return;
    }
    const progress = {
      current: state.jobs.scan.current,
      message: state.jobs.scan.message,
    };
    const prev = prevScanProgress.current;
    if (progress.current === prev.current && progress.message === prev.message) {
      return;
    }
    prevScanProgress.current = progress;

    const timeout = window.setTimeout(() => {
      void loadTracks(query, page, minRating, hideDuplicates, tagNames);
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [
    state.jobs.scan.running,
    state.jobs.scan.current,
    state.jobs.scan.message,
    query,
    page,
    minRating,
    hideDuplicates,
    tagNames,
  ]);

  useEffect(() => {
    void loadStatus();
  }, [state.jobs.scan.running, state.jobs.lyricsFetch.running, state.jobs.scan.message]);

  const rememberSearch = (term: string) => {
    const trimmed = term.trim();
    if (!trimmed) {
      return;
    }
    setSearchHistory(addSearchHistoryTerm(trimmed));
  };

  const applySearch = (term: string) => {
    if (term !== inputValue) {
      skipHistoryRecordRef.current = true;
    }
    setInputValue(term);
    setQuery(term);
    setPage(1);
    rememberSearch(term);
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setQuery(inputValue);
      setPage(1);
      if (skipHistoryRecordRef.current) {
        skipHistoryRecordRef.current = false;
        return;
      }
      rememberSearch(inputValue);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [inputValue]);

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    applySearch(inputValue);
  };

  const resetSearch = () => {
    skipHistoryRecordRef.current = true;
    setInputValue('');
    setQuery('');
    setMinRating(0);
    setHideDuplicates(false);
    setTagNames([]);
    setPage(1);
  };

  const pickRandomArtist = async () => {
    try {
      const { artist } = await api.randomArtist(inputValue);
      applySearch(artist);
    } catch {
      /* no artists in library — leave search unchanged */
    }
  };

  const appliedFilters: LibraryFiltersDraft = { minRating, hideDuplicates, tags: tagNames };
  const filterCount = activeFilterCount(appliedFilters);
  const searchIsClear =
    inputValue === '' &&
    query === '' &&
    minRating === 0 &&
    hideDuplicates === false &&
    tagNames.length === 0;

  const changeSort = (next: LibrarySort) => {
    setSort(next);
    setPage(1);
    try {
      sessionStorage.setItem(LIBRARY_SORT_KEY, next);
    } catch {
      /* private mode */
    }
  };

  const openFilters = () => {
    setFiltersDraft(appliedFilters);
    setFiltersOpen(true);
  };

  const applyFilters = () => {
    setMinRating(filtersDraft.minRating);
    setHideDuplicates(filtersDraft.hideDuplicates);
    setTagNames(filtersDraft.tags);
    setPage(1);
    setFiltersOpen(false);
  };

  const setTrackRating = async (trackId: number, rating: number) => {
    try {
      const updated = await api.setTrackRating(trackId, rating);
      setTracks((prev) =>
        prev.map((track) => (track.id === trackId ? { ...track, rating: updated.rating } : track)),
      );
      if (minRating > 0 && (updated.rating ?? 0) < minRating) {
        await loadTracks(query, page, minRating);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const fetchTrackLyrics = async (trackId: number) => {
    const existing = tracks.find((item) => item.id === trackId);
    if (
      existing?.lyricStatus === 'not_found' ||
      existing?.lyricStatus === 'unavailable'
    ) {
      setLyricSearchTrack(existing);
      return;
    }

    setFetchingIds((prev) => new Set(prev).add(trackId));
    try {
      const updated = await api.fetchTrackLyrics(trackId);
      await loadTracks(query, page);
      if (
        updated.lyricStatus !== 'present' &&
        updated.lyricStatus !== 'instrumental'
      ) {
        setLyricSearchTrack(updated);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingIds((prev) => {
        const next = new Set(prev);
        next.delete(trackId);
        return next;
      });
    }
  };

  const runLibraryScan = async (acknowledgeInvalidRoots = false) => {
    try {
      await api.scan({ acknowledgeInvalidRoots });
      await loadStatus();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { invalidLibraryPaths?: InvalidLibraryPathDto[] };
        const invalid = body.invalidLibraryPaths ?? [];
        if (invalid.length > 0) {
          setScanInvalidPaths(invalid);
          return;
        }
      }
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleScanClick = () => {
    if (state.jobs.scan.running) {
      void api.cancelScan();
      return;
    }
    confirmModal.request(MODAL_IDS.scanHelp, () => void runLibraryScan());
  };

  const handleRefreshScanClick = () => {
    void api.refreshScan().then(() => loadStatus());
  };

  const handleFetchLyricsClick = () => {
    if (state.jobs.lyricsFetch.running) {
      void api.cancelFetchLyrics();
      return;
    }
    confirmModal.request(MODAL_IDS.lyricsHelp, () => api.fetchLyrics());
  };

  const handleCreateThumbnailsClick = () => {
    if (state.jobs.covers.running) {
      void api.cancelThumbnails();
      return;
    }
    confirmModal.request(MODAL_IDS.coversHelp, () => api.createThumbnails());
  };

  const handleCreatePlaylist = async (name: string) => {
    try {
      const created = await api.createPlaylist(name);
      await loadPlaylists();
      setSelectedPlaylistId(created.id);
      setPlaylistDetail(created);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRenamePlaylist = async (id: number, name: string) => {
    try {
      const updated = await api.updatePlaylist(id, { name });
      await loadPlaylists();
      if (selectedPlaylistId === id) {
        setPlaylistDetail(updated);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const performDeletePlaylist = async (id: number) => {
    try {
      await api.deletePlaylist(id);
      await loadPlaylists();
      if (selectedPlaylistId === id) {
        setSelectedPlaylistId(null);
        setPlaylistDetail(null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDeletePlaylist = (id: number) => {
    const isEmpty =
      playlistDetail?.id === id
        ? playlistDetail.items.length === 0
        : (playlistSummaries.find((playlist) => playlist.id === id)?.itemCount ?? 0) === 0;
    if (isEmpty) {
      void performDeletePlaylist(id);
      return;
    }
    confirmModal.request(MODAL_IDS.playlistDelete, () => performDeletePlaylist(id));
  };

  const handleRemovePlaylistItem = async (itemId: number) => {
    if (selectedPlaylistId == null) {
      return;
    }
    try {
      const updated = await api.removeFromPlaylist(selectedPlaylistId, itemId);
      setPlaylistDetail(updated);
      await loadPlaylists();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadPlaylistIntoQueue = async (playlistId: number, mode: PlaylistQueueMode) => {
    try {
      await api.loadPlaylistIntoQueue(playlistId, mode);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleClearQueue = () => {
    if (state.playback.status !== 'playing') {
      void (async () => {
        try {
          await api.clearQueue();
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })();
      return;
    }
    setClearQueueModalOpen(true);
  };

  const handleShuffleQueue = () => {
    void (async () => {
      try {
        await api.shuffleQueue();
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const handleToggleLoopQueue = (enabled: boolean) => {
    void (async () => {
      try {
        await api.setLoopQueue(enabled);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const runClearQueue = async (mode: 'all' | 'except_current' | 'before_current') => {
    setClearQueueModalOpen(false);
    try {
      await api.clearQueue(mode);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePlayPlaylist = (playlistId: number) => {
    if (state.queue.length === 0) {
      void loadPlaylistIntoQueue(playlistId, 'replace');
      return;
    }
    setPlayModalPlaylistId(playlistId);
  };

  const handleRemoveAiStem = (track: TrackDto) => {
    setRemoveStemTrack(track);
  };

  const handleDeleteFile = (track: TrackDto) => {
    setDeleteFileTrack(track);
  };

  const confirmDeleteFile = async () => {
    if (!deleteFileTrack) {
      return;
    }
    const trackId = deleteFileTrack.id;
    setDeleteFileTrack(null);
    try {
      await api.deleteTrack(trackId);
      setTracks((prev) => prev.filter((track) => track.id !== trackId));
      setTotal((prev) => Math.max(0, prev - 1));
      if (tracks.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await loadTracks(query, page, minRating);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmRemoveAiStem = async () => {
    if (!removeStemTrack) {
      return;
    }
    const trackId = removeStemTrack.id;
    setRemoveStemTrack(null);
    try {
      await api.removeKaraokeStem(trackId);
      setTracks((prev) =>
        prev.map((track) =>
          track.id === trackId ? { ...track, karaokeStemStatus: null } : track,
        ),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePlayTrack = (track: TrackDto) => {
    if (state.playback.status === 'playing') {
      setPlayModalTrack(track);
      return;
    }
    void (async () => {
      try {
        await api.playTrackNow(track.id);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const handlePlayTrackNow = () => {
    if (!playModalTrack) {
      return;
    }
    const trackId = playModalTrack.id;
    setPlayModalTrack(null);
    void (async () => {
      try {
        const added = await api.playTrackNow(trackId);
        setRevealQueueItemId(added?.id ?? null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const handleQueueTrackAtEnd = () => {
    if (!playModalTrack) {
      return;
    }
    const trackId = playModalTrack.id;
    setPlayModalTrack(null);
    void (async () => {
      try {
        await api.addToQueue(trackId, 'end');
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const handleQueueTrackAfterCurrent = () => {
    if (!playModalTrack) {
      return;
    }
    const trackId = playModalTrack.id;
    setPlayModalTrack(null);
    void (async () => {
      try {
        await api.addToQueue(trackId, 'after_current');
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const revealFirstAdded = (
    beforeIds: Set<number>,
    queue: Awaited<ReturnType<typeof api.addTracksToQueue>>,
  ) => {
    const firstNew = queue.find((item) => !beforeIds.has(item.id));
    setRevealQueueItemId(firstNew?.id ?? null);
  };

  const handlePlayExplorerPage = () => {
    if (tracks.length === 0) {
      return;
    }
    if (state.playback.status === 'playing') {
      setPlayModalPageTracks(tracks);
      return;
    }
    const trackIds = tracks.map((track) => track.id);
    void (async () => {
      try {
        const added = await api.playTracksNow(trackIds);
        setRevealQueueItemId(added?.id ?? null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const handlePlayExplorerPageNow = () => {
    if (!playModalPageTracks?.length) {
      return;
    }
    const trackIds = playModalPageTracks.map((track) => track.id);
    setPlayModalPageTracks(null);
    void (async () => {
      try {
        const added = await api.playTracksNow(trackIds);
        setRevealQueueItemId(added?.id ?? null);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const handleQueueExplorerPageAtEnd = () => {
    if (!playModalPageTracks?.length) {
      return;
    }
    const trackIds = playModalPageTracks.map((track) => track.id);
    const beforeIds = new Set(state.queue.map((item) => item.id));
    setPlayModalPageTracks(null);
    void (async () => {
      try {
        const queue = await api.addTracksToQueue(trackIds, 'end');
        revealFirstAdded(beforeIds, queue);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const handleQueueExplorerPageAfterCurrent = () => {
    if (!playModalPageTracks?.length) {
      return;
    }
    const trackIds = playModalPageTracks.map((track) => track.id);
    const beforeIds = new Set(state.queue.map((item) => item.id));
    setPlayModalPageTracks(null);
    void (async () => {
      try {
        const queue = await api.addTracksToQueue(trackIds, 'after_current');
        revealFirstAdded(beforeIds, queue);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  };

  const playModalPlaylist = playlistSummaries.find(
    (entry) => entry.id === playModalPlaylistId,
  );

  const currentQueueIndex = state.queue.findIndex(
    (item) => item.id === state.playback.currentQueueItemId,
  );
  const hasQueueBeforeCurrent = currentQueueIndex > 0;

  const pages = Math.max(1, Math.ceil(total / limit));
  const modalCopy =
    confirmModal.dismissId === MODAL_IDS.scanHelp
      ? {
          title: 'Scan library',
          confirmLabel: 'Start scan',
          body: (
            <ul className="modal-help-list">
              <li>
                Walks each library folder from{' '}
                <Link to="/settings">Settings</Link> for <code>.mp3</code>,{' '}
                <code>.flac</code>, and <code>.opus</code> files.
              </li>
              <li>
                Reads tags and duration, updates the catalogue, and marks tracks
                missing from disk as unavailable.
              </li>
              <li>
                Detects sidecar <code>.lrc</code> files next to audio files; it
                does not download lyrics.
              </li>
              <li>
                Scans top-level folders in batches and shows progress here
                (for example{' '}
                <code>Scanning Rock (3/12) · 1,200 files · ~85/s</code>
                ).
              </li>
              <li>
                Already-indexed files are skipped unless size or mtime changed;
                sidecar <code>.lrc</code> files are still checked each scan unless{' '}
                <code>LIBRARY_SCAN_SKIP_LRC_ON_UNCHANGED=1</code>.
              </li>
              <li>
                Cancelled scans resume from the last completed top-level folder on
                the next scan.
              </li>
              <li>
                Optional env tuning: chunk size, metadata concurrency, FS timeouts,
                and directory mtime skipping (often unreliable on Samba).
              </li>
              <li>
                After changing library folders on Settings, choose{' '}
                <strong>Apply / Rebase</strong> so catalogue paths match before
                you scan.
              </li>
              <li>Tracks appear in the library as each batch completes.</li>
              <li>
                If folders or files cannot be read, a scrollable list appears when
                the scan finishes.
              </li>
            </ul>
          ),
        }
      : confirmModal.dismissId === MODAL_IDS.lyricsHelp
        ? {
            title: 'Fetch missing lyrics',
            confirmLabel: 'Start fetch',
            body: (
              <ul className="modal-help-list">
                <li>
                  Queries LRCLIB for tracks that still need lyrics, including retries
                  for older &ldquo;not found&rdquo; results after 60 days.
                </li>
                <li>Writes <code>.lrc</code> files next to the audio files.</li>
                <li>
                  Skips tracks that already have lyrics. Requests are rate-limited, so
                  a full pass can take a while.
                </li>
                <li>The same button cancels a running fetch.</li>
              </ul>
            ),
          }
        : confirmModal.dismissId === MODAL_IDS.coversHelp
          ? {
              title: 'Create thumbnails',
              confirmLabel: 'Start',
              body: (
                <ul className="modal-help-list">
                  <li>
                    Builds one pair of cover thumbnails per album rather than per
                    track, so a large library stays small on disk.
                  </li>
                  <li>
                    Artwork comes from a sidecar image in the album folder
                    (<code>cover.jpg</code>, <code>folder.jpg</code>, and similar)
                    or, failing that, the front cover embedded in the audio file.
                  </li>
                  <li>
                    Albums without artwork are remembered as empty and are not
                    inspected again until the files change.
                  </li>
                  <li>
                    Thumbnails are also created on demand as you browse; this pass
                    just does the whole library at once.
                  </li>
                  <li>The same button cancels a running pass.</li>
                </ul>
              ),
            }
          : confirmModal.dismissId === MODAL_IDS.playlistDelete
            ? {
                title: 'Delete playlist',
                confirmLabel: 'Delete',
                body: (
                  <p>
                    This permanently deletes the playlist and its item order. Audio files
                    in your library are not affected.
                  </p>
                ),
              }
            : null;

  return (
    <div className="app-shell">
      <section className="toolbar">
        <form className="search" onSubmit={onSearch}>
          <input
            name="q"
            placeholder="Search title, artist, album"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            autoComplete="off"
          />
          <button
            type="button"
            className="icon-btn"
            onClick={() => void pickRandomArtist()}
            title="Random"
            aria-label="Random"
          >
            <LuDices aria-hidden />
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setHistoryOpen(true)}
            title="History"
            aria-label="History"
          >
            <LuHistory aria-hidden />
          </button>
          <label className="sort-control">
            Sort
            <select
              aria-label="Sort"
              value={sort}
              onChange={(event) => changeSort(parseLibrarySort(event.target.value))}
            >
              <option value="relevance">Relevance</option>
              <option value="album">Album</option>
              <option value="artist">Artist</option>
              <option value="title">Title</option>
            </select>
          </label>
          <button type="button" onClick={openFilters}>
            {filtersButtonLabel(filterCount)}
          </button>
          <button type="button" disabled={searchIsClear} onClick={resetSearch}>
            Reset
          </button>
        </form>
        <AppTopbar
          eyebrow="I can't sing, but it's going to be..."
          title={
            <>
              <span className="brand-kara">Kara</span>okej
            </>
          }
          scanOpen={scanOpen}
          onScan={() => setScanOpen(true)}
          extras={
            isPlayer ? (
              <span className="pill ok toolbar-player">This device plays audio</span>
            ) : (
              <button
                type="button"
                className="toolbar-player"
                onClick={() => void api.claim(clientId)}
              >
                Play audio here
              </button>
            )
          }
        />
      </section>

      {error && <p className="error-banner">{error}</p>}

      <WorkspaceDnd
        tracks={tracks}
        queue={state.queue}
        currentQueueItemId={state.playback.currentQueueItemId}
        playlistSummaries={playlistSummaries}
        selectedPlaylistId={selectedPlaylistId}
        playlistDetail={playlistDetail}
        onSelectPlaylist={setSelectedPlaylistId}
        onCreatePlaylist={(name) => void handleCreatePlaylist(name)}
        onRenamePlaylist={(id, name) => void handleRenamePlaylist(id, name)}
        onDeletePlaylist={handleDeletePlaylist}
        onRemovePlaylistItem={(itemId) => void handleRemovePlaylistItem(itemId)}
        onPlayPlaylist={handlePlayPlaylist}
        onClearQueue={handleClearQueue}
        onShuffleQueue={handleShuffleQueue}
        loopQueue={state.playback.loopQueue}
        onToggleLoopQueue={handleToggleLoopQueue}
        onExplorerBatchDrop={clearExplorerSelection}
        onPlaylistChanged={setPlaylistDetail}
        onPlaylistsRefresh={() => void loadPlaylists()}
        onPlayTrack={handlePlayTrack}
        onShowCover={setCoverTrack}
        onApplySearchTerm={applySearch}
        onManageTags={setTagTrack}
        revealQueueItemId={revealQueueItemId}
        onRevealQueueItem={clearRevealQueueItem}
        library={({ activeTrackDragIds }) => (
          <LibraryExplorerPane
            trackCount={tracks.length}
            onPlayPage={handlePlayExplorerPage}
          >
            <div className="library-pane-scroll">
              {tracks.length === 0 && !query.trim() ? (
                <p className="empty">No songs match. Scan the library if it is empty.</p>
              ) : (
                <>
                  {tracks.length > 0 ? (
                    <ul className="track-list">
                      {tracks.map((track, index) => {
                        const rank = (page - 1) * limit + index;
                        const selected = selectedTrackIds.has(track.id);
                        const batchTrackIds = selected
                          ? orderedSelectedTrackIds
                          : [track.id];
                        const batchDragging =
                          activeTrackDragIds != null &&
                          activeTrackDragIds.length > 1 &&
                          selected &&
                          activeTrackDragIds.includes(track.id);
                        return (
                          <DraggableTrackRow
                            key={track.id}
                            track={track}
                            selected={selected}
                            batchDragging={batchDragging}
                            batchTrackIds={batchTrackIds}
                            fetching={fetchingIds.has(track.id)}
                            onFetchLyrics={(trackId) => void fetchTrackLyrics(trackId)}
                            onRate={setTrackRating}
                            onApplySearchTerm={applySearch}
                            onPlay={handlePlayTrack}
                            onEditMetadata={setMetadataTrack}
                            onRemoveAiStem={handleRemoveAiStem}
                            onDeleteFile={handleDeleteFile}
                            onShowCover={setCoverTrack}
                            onManageTags={setTagTrack}
                            onToggleSelect={() => toggleTrackSelection(track, rank)}
                            showTrackNo={sort === 'album'}
                          />
                        );
                      })}
                    </ul>
                  ) : null}
                  {query.trim() ? (
                    <SearchMissFallback
                      query={query.trim()}
                      hasLibraryMatches={tracks.length > 0}
                      ytdlpAvailable={status?.ytdlpAvailable ?? false}
                      ytsaverAvailable={status?.ytsaverAvailable ?? false}
                      downloadRunning={state.jobs.download.running}
                      downloadMessage={state.jobs.download.message}
                      onTrackDownloaded={(track) => {
                        void loadTracks(query, page, minRating, hideDuplicates);
                        handlePlayTrack(track);
                      }}
                    />
                  ) : null}
                </>
              )}
              <div className="pager">
              <button
                type="button"
                className="icon-btn"
                disabled={page <= 1}
                onClick={() => setPage(1)}
                title="First"
                aria-label="First"
              >
                <FiChevronsLeft aria-hidden />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                title="Previous"
                aria-label="Previous"
              >
                <FiChevronLeft aria-hidden />
              </button>
              <label className="pager-select">
                <span className="pager-select-label">Page</span>
                <select
                  value={Math.min(page, Math.max(pages, 1))}
                  disabled={pages <= 1}
                  aria-label={`Page ${page} of ${pages}`}
                  onChange={(event) => setPage(Number(event.target.value))}
                >
                  {Array.from({ length: Math.max(pages, 1) }, (_, i) => i + 1).map((p) => (
                    <option key={p} value={p}>
                      {p} / {Math.max(pages, 1)}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="icon-btn"
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                title="Next"
                aria-label="Next"
              >
                <FiChevronRight aria-hidden />
              </button>
              <button
                type="button"
                className="icon-btn"
                disabled={page >= pages}
                onClick={() => setPage(pages)}
                title="Last"
                aria-label="Last"
              >
                <FiChevronsRight aria-hidden />
              </button>
              <span className="pager-summary">
                Page {page} / {pages} · {total} songs
              </span>
              </div>
            </div>
          </LibraryExplorerPane>
        )}
      />

      <ScanModal
        open={scanOpen}
        status={status}
        scan={state.jobs.scan}
        lyricsFetch={state.jobs.lyricsFetch}
        download={state.jobs.download}
        covers={state.jobs.covers}
        onClose={() => setScanOpen(false)}
        onScan={handleScanClick}
        onRefreshScan={handleRefreshScanClick}
        onFetchLyrics={handleFetchLyricsClick}
        onCreateThumbnails={handleCreateThumbnailsClick}
      />

      {modalCopy && (
        <Modal
          open={confirmModal.open}
          title={modalCopy.title}
          confirmLabel={modalCopy.confirmLabel}
          permanentlyDismissible
          onConfirm={confirmModal.confirm}
          onCancel={confirmModal.cancel}
        >
          {modalCopy.body}
        </Modal>
      )}

      <ScanIssuesModal
        open={scanIssuesOpen}
        issues={scanIssues}
        onClose={() => setScanIssuesOpen(false)}
      />

      <Modal
        open={scanInvalidPaths != null}
        title="Some library folders are unavailable"
        confirmLabel="Scan anyway"
        onConfirm={() => {
          setScanInvalidPaths(null);
          void runLibraryScan(true);
        }}
        onCancel={() => setScanInvalidPaths(null)}
      >
        <p>
          These saved folders cannot be scanned. Scan will continue with the
          folders that are reachable.
        </p>
        <ul className="modal-help-list">
          {scanInvalidPaths?.map((entry) => (
            <li key={entry.path}>
              <code>{entry.path}</code> — {entry.reason}
            </li>
          ))}
        </ul>
        <p>
          Fix or remove them on <Link to="/settings">Settings</Link>.
        </p>
      </Modal>

      <CoverArtModal
        track={coverTrack}
        onClose={() => setCoverTrack(null)}
        onSearch={applySearch}
      />

      {playModalPlaylist && (
        <PlayPlaylistModal
          open={playModalPlaylistId != null}
          playlistName={playModalPlaylist.name}
          onAppend={() => {
            void loadPlaylistIntoQueue(playModalPlaylist.id, 'append');
            setPlayModalPlaylistId(null);
          }}
          onReplace={() => {
            void loadPlaylistIntoQueue(playModalPlaylist.id, 'replace');
            setPlayModalPlaylistId(null);
          }}
          onCancel={() => setPlayModalPlaylistId(null)}
        />
      )}

      {playModalTrack && (
        <PlayTrackModal
          open={playModalTrack != null}
          trackTitle={playModalTrack.title}
          onPlayNow={handlePlayTrackNow}
          onQueueAtEnd={handleQueueTrackAtEnd}
          onQueueAfterCurrent={handleQueueTrackAfterCurrent}
          onCancel={() => setPlayModalTrack(null)}
        />
      )}

      {playModalPageTracks && (
        <PlayTrackModal
          open={playModalPageTracks != null}
          trackTitle={playModalPageTracks[0]?.title ?? 'Songs'}
          songCount={playModalPageTracks.length}
          onPlayNow={handlePlayExplorerPageNow}
          onQueueAtEnd={handleQueueExplorerPageAtEnd}
          onQueueAfterCurrent={handleQueueExplorerPageAfterCurrent}
          onCancel={() => setPlayModalPageTracks(null)}
        />
      )}

      <Modal
        open={removeStemTrack != null}
        title="Remove AI stem"
        confirmLabel="Remove"
        onConfirm={() => void confirmRemoveAiStem()}
        onCancel={() => setRemoveStemTrack(null)}
      >
        <p>
          Remove the AI instrumental stem for{' '}
          <strong>{removeStemTrack?.title}</strong>? This deletes the cached
          file. You can generate it again later.
        </p>
      </Modal>

      <Modal
        open={deleteFileTrack != null}
        title="Delete file"
        confirmLabel="Delete"
        onConfirm={() => void confirmDeleteFile()}
        onCancel={() => setDeleteFileTrack(null)}
      >
        <p>
          Permanently delete <strong>{deleteFileTrack?.title}</strong> from disk
          and remove it from the library?
          {deleteFileTrack &&
          (state.playback.currentTrack?.id === deleteFileTrack.id ||
            state.queue.some((item) => item.track.id === deleteFileTrack.id)) ? (
            <>
              {' '}
              This track is in the queue
              {state.playback.currentTrack?.id === deleteFileTrack.id
                ? ' and is currently playing'
                : ''}
              ; playback will stop or advance.
            </>
          ) : null}
        </p>
      </Modal>

      <ClearQueueModal
        open={clearQueueModalOpen}
        currentTrackTitle={state.playback.currentTrack?.title ?? null}
        hasBeforeCurrent={hasQueueBeforeCurrent}
        onRemoveAll={() => void runClearQueue('all')}
        onKeepCurrent={() => void runClearQueue('except_current')}
        onRemoveBeforeCurrent={() => void runClearQueue('before_current')}
        onCancel={() => setClearQueueModalOpen(false)}
      />

      <SearchHistoryModal
        open={historyOpen}
        terms={searchHistory}
        onSelect={(term) => {
          setHistoryOpen(false);
          applySearch(term);
        }}
        onClear={() => {
          clearSearchHistory();
          setSearchHistory([]);
        }}
        onClose={() => setHistoryOpen(false)}
      />

      {tagTrack ? (
        <TagPickerModal
          mode="assign"
          track={tagTrack}
          onClose={() => setTagTrack(null)}
          onSaved={(updated) => {
            setTracks((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
            setPlaylistDetail((prev) =>
              prev
                ? {
                    ...prev,
                    items: prev.items.map((item) =>
                      item.track.id === updated.id ? { ...item, track: updated } : item,
                    ),
                  }
                : prev,
            );
            const stillMatches = tagNames.every((name) =>
              updated.tags.some((tag) => tag.toLowerCase() === name.toLowerCase()),
            );
            if (tagNames.length > 0 && !stillMatches) {
              void loadTracks(query, page, minRating, hideDuplicates, tagNames);
            }
          }}
        />
      ) : null}
      {importTagNames.length > 0 ? (
        <TagImportModal
          names={importTagNames}
          onClose={() => setImportTagNames([])}
          onImported={() => {
            void loadTracks(query, page, minRating, hideDuplicates, tagNames);
            if (selectedPlaylistId != null) {
              void loadPlaylistDetail(selectedPlaylistId);
            }
          }}
        />
      ) : null}

      <LibraryFiltersModal
        open={filtersOpen}
        draft={filtersDraft}
        onDraftChange={setFiltersDraft}
        onApply={applyFilters}
        onCancel={() => setFiltersOpen(false)}
      />

      <LyricSearchModal
        open={lyricSearchTrack != null}
        track={lyricSearchTrack}
        onClose={() => setLyricSearchTrack(null)}
        onApplied={() => void loadTracks(query, page)}
      />

      <TrackMetadataModal
        open={metadataTrack != null}
        track={metadataTrack}
        onClose={() => setMetadataTrack(null)}
        onSaved={(updated) => {
          setTracks((prev) =>
            prev.map((track) => (track.id === updated.id ? updated : track)),
          );
        }}
      />

      <PlayerBar onShowCover={setCoverTrack} />
    </div>
  );
}

function LibraryExplorerPane({
  children,
  trackCount,
  onPlayPage,
}: {
  children: ReactNode;
  trackCount: number;
  onPlayPage: () => void;
}) {
  const accordion = useWorkspaceAccordion();
  const paneOpen = accordion.isOpen('library');
  const addLabel =
    trackCount === 1
      ? 'Play page · adds 1 song'
      : `Play page · adds ${trackCount} songs`;

  return (
    <section className={`library-pane${paneAccordionClass('library', accordion)}`}>
      <div className="library-pane-toolbar">
        <PaneAccordionTrigger pane="library">
          <h2>Explorer</h2>
        </PaneAccordionTrigger>
        {paneOpen && (
          <button
            type="button"
            className="icon-btn"
            title={addLabel}
            aria-label={addLabel}
            disabled={trackCount === 0}
            onClick={onPlayPage}
          >
            <span className="icon-play-plus" aria-hidden>
              <FiPlay />
              <FiPlus className="icon-play-plus-badge" />
            </span>
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
