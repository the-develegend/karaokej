import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  METADATA_SEARCH_PROVIDER_IDS,
  MetadataProviderTriedDto,
  MetadataSearchHitDto,
  MetadataSearchProviderId,
  TrackDto,
  TrackMetadataDto,
  TrackMetadataUpdateDto,
  TrackMovePreviewDto,
} from '@karaokej/shared';
import { api } from '../api';
import { saveFailureMessage } from './metadata-save-error';
import {
  formatCompareDuration,
  formatDuration,
  metadataDurationCompareState,
} from '../format';
import { ModalDialog } from './ModalDialog';
import { ProcessingText } from './ProcessingText';
import { StarRating } from './StarRating';
import { useSession } from '../session/SessionProvider';

interface TrackMetadataModalProps {
  open: boolean;
  track: TrackDto | null;
  onClose: () => void;
  onSaved?: (track: TrackDto) => void;
  closeOnBackdropClick?: boolean;
}

type LoadPhase = 'idle' | 'loading' | 'ready' | 'error';
type MovePhase = 'idle' | 'confirm' | 'moving';
type SearchPhase = 'idle' | 'searching' | 'done';

interface FormSnapshot {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  trackNo: string;
  year: string;
  genres: string;
  rating: number;
  musicbrainzArtistId: string;
  musicbrainzRecordingId: string;
  musicbrainzReleaseId: string;
  isrc: string;
}

const COMPARE_FIELDS: Array<{
  key: keyof FormSnapshot;
  label: string;
  skipInApply?: boolean;
}> = [
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'albumArtist', label: 'Album artist' },
  { key: 'trackNo', label: 'Track number' },
  { key: 'year', label: 'Year' },
  { key: 'genres', label: 'Genres' },
  { key: 'musicbrainzArtistId', label: 'MusicBrainz artist ID' },
  { key: 'musicbrainzRecordingId', label: 'MusicBrainz recording ID' },
  { key: 'musicbrainzReleaseId', label: 'MusicBrainz release ID' },
  { key: 'isrc', label: 'ISRC' },
  { key: 'rating', label: 'Rating', skipInApply: true },
];

function genresToInput(genres: string[]): string {
  return genres.join(', ');
}

function snapshotFromMetadata(metadata: TrackMetadataDto): FormSnapshot {
  return {
    title: metadata.title,
    artist: metadata.artist ?? '',
    album: metadata.album ?? '',
    albumArtist: metadata.albumArtist ?? '',
    trackNo: metadata.trackNo != null ? String(metadata.trackNo) : '',
    year: metadata.year != null ? String(metadata.year) : '',
    genres: genresToInput(metadata.genres),
    rating: metadata.rating,
    musicbrainzArtistId: metadata.musicbrainzArtistId ?? '',
    musicbrainzRecordingId: metadata.musicbrainzRecordingId ?? '',
    musicbrainzReleaseId: metadata.musicbrainzReleaseId ?? '',
    isrc: metadata.isrc ?? '',
  };
}

function currentSnapshot(
  title: string,
  artist: string,
  album: string,
  albumArtist: string,
  trackNo: string,
  year: string,
  genres: string,
  rating: number,
  musicbrainzArtistId: string,
  musicbrainzRecordingId: string,
  musicbrainzReleaseId: string,
  isrc: string,
): FormSnapshot {
  return {
    title,
    artist,
    album,
    albumArtist,
    trackNo,
    year,
    genres,
    rating,
    musicbrainzArtistId,
    musicbrainzRecordingId,
    musicbrainzReleaseId,
    isrc,
  };
}

function snapshotsEqual(a: FormSnapshot, b: FormSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function displayValue(snapshot: FormSnapshot, key: keyof FormSnapshot): string {
  const raw = snapshot[key];
  if (key === 'trackNo' || key === 'year') {
    return typeof raw === 'string' && raw.trim() ? raw : '—';
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw;
  }
  return '—';
}

function hitToFormValues(hit: MetadataSearchHitDto): Partial<FormSnapshot> {
  return {
    title: hit.title,
    artist: hit.artist ?? '',
    album: hit.album ?? '',
    albumArtist: hit.albumArtist ?? '',
    trackNo: hit.trackNo != null ? String(hit.trackNo) : '',
    year: hit.year != null ? String(hit.year) : '',
    genres: genresToInput(hit.genres),
    musicbrainzArtistId: hit.musicbrainzArtistId ?? '',
    musicbrainzRecordingId: hit.musicbrainzRecordingId ?? '',
    musicbrainzReleaseId: hit.musicbrainzReleaseId ?? '',
    isrc: hit.isrc ?? '',
  };
}

const PROVIDER_LABELS: Record<MetadataSearchProviderId, string> = {
  musicbrainz: 'MusicBrainz',
  discogs: 'Discogs',
  lastfm: 'Last.fm',
  gnudb: 'GnuDB',
  spotify: 'Spotify',
};

export function TrackMetadataModal({
  open,
  track,
  onClose,
  onSaved,
  closeOnBackdropClick,
}: TrackMetadataModalProps) {
  const { state } = useSession();
  const [phase, setPhase] = useState<LoadPhase>('idle');
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [album, setAlbum] = useState('');
  const [albumArtist, setAlbumArtist] = useState('');
  const [trackNo, setTrackNo] = useState('');
  const [year, setYear] = useState('');
  const [genres, setGenres] = useState('');
  const [rating, setRating] = useState(0);
  const [musicbrainzArtistId, setMusicbrainzArtistId] = useState('');
  const [musicbrainzRecordingId, setMusicbrainzRecordingId] = useState('');
  const [musicbrainzReleaseId, setMusicbrainzReleaseId] = useState('');
  const [isrc, setIsrc] = useState('');
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [savedBaseline, setSavedBaseline] = useState<FormSnapshot | null>(null);
  const [diskSnapshot, setDiskSnapshot] = useState<FormSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveErrorRef = useRef<HTMLParagraphElement>(null);
  const [moveFieldErrors, setMoveFieldErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [movePhase, setMovePhase] = useState<MovePhase>('idle');
  const [movePreview, setMovePreview] = useState<TrackMovePreviewDto | null>(
    null,
  );
  const [removeEmptyDirs, setRemoveEmptyDirs] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [searchPhase, setSearchPhase] = useState<SearchPhase>('idle');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<
    MetadataSearchProviderId[]
  >([]);
  const [tryingProvider, setTryingProvider] = useState<MetadataSearchProviderId | null>(
    null,
  );
  const [triedProviders, setTriedProviders] = useState<MetadataProviderTriedDto[]>(
    [],
  );
  const [hits, setHits] = useState<MetadataSearchHitDto[]>([]);
  const [hitIndex, setHitIndex] = useState(0);

  const formSnapshot = useMemo(
    () =>
      currentSnapshot(
        title,
        artist,
        album,
        albumArtist,
        trackNo,
        year,
        genres,
        rating,
        musicbrainzArtistId,
        musicbrainzRecordingId,
        musicbrainzReleaseId,
        isrc,
      ),
    [
      title,
      artist,
      album,
      albumArtist,
      trackNo,
      year,
      genres,
      rating,
      musicbrainzArtistId,
      musicbrainzRecordingId,
      musicbrainzReleaseId,
      isrc,
    ],
  );

  const dirty =
    savedBaseline != null && !snapshotsEqual(formSnapshot, savedBaseline);

  const defaultSearchProviders = useMemo((): MetadataSearchProviderId[] => {
    const mp = state.settings.metadataProviders;
    return mp.order
      .filter((id): id is MetadataSearchProviderId =>
        (METADATA_SEARCH_PROVIDER_IDS as readonly string[]).includes(id),
      )
      .filter((id) => {
        const cfg = mp[id];
        if (!cfg?.enabled) {
          return false;
        }
        switch (id) {
          case 'musicbrainz':
            return mp.musicbrainz.contactEmail.includes('@');
          case 'discogs':
            return mp.discogs.tokenSaved;
          case 'lastfm':
            return mp.lastfm.apiKeySaved;
          case 'gnudb':
            return mp.gnudb.contactEmail.includes('@');
          case 'spotify':
            return mp.spotify.clientId.length > 0 && mp.spotify.clientSecretSaved;
          default:
            return false;
        }
      });
  }, [state.settings.metadataProviders]);

  const defaultSearchProvidersRef = useRef(defaultSearchProviders);
  defaultSearchProvidersRef.current = defaultSearchProviders;
  const trackId = track?.id ?? null;

  useEffect(() => {
    if (!open || trackId == null) {
      return;
    }
    // Playback broadcasts a fresh session (including when a song ends) with a
    // new settings object. Reloading here would wipe an in-progress edit or
    // metadata search even though this track did not change.
    let cancelled = false;
    setPhase('loading');
    setError(null);
    setSaveError(null);
    setSaving(false);
    setMovePhase('idle');
    setMovePreview(null);
    setMoveFieldErrors([]);
    setSavedBaseline(null);
    setDiskSnapshot(null);
    setCompareMode(false);
    setSearchPhase('idle');
    setHits([]);
    setHitIndex(0);
    setTriedProviders([]);
    setTryingProvider(null);
    const providers = defaultSearchProvidersRef.current;
    void api
      .readTrackMetadata(trackId)
      .then((metadata: TrackMetadataDto) => {
        if (cancelled) {
          return;
        }
        const snapshot = snapshotFromMetadata(metadata);
        setTitle(snapshot.title);
        setArtist(snapshot.artist);
        setAlbum(snapshot.album);
        setAlbumArtist(snapshot.albumArtist);
        setTrackNo(snapshot.trackNo);
        setYear(snapshot.year);
        setGenres(snapshot.genres);
        setRating(snapshot.rating);
        setMusicbrainzArtistId(snapshot.musicbrainzArtistId);
        setMusicbrainzRecordingId(snapshot.musicbrainzRecordingId);
        setMusicbrainzReleaseId(snapshot.musicbrainzReleaseId);
        setIsrc(snapshot.isrc);
        setDurationMs(metadata.durationMs);
        setSavedBaseline(snapshot);
        setDiskSnapshot(snapshot);
        const q = [snapshot.artist, snapshot.title].filter(Boolean).join(' ');
        setSearchQuery(q);
        setSelectedProviders(providers);
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, trackId]);

  useEffect(() => {
    if (!saveError) {
      return;
    }
    saveErrorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [saveError]);

  const parseSaveFields = ():
    | { ok: false; error: string }
    | {
        ok: true;
        payload: TrackMetadataUpdateDto;
        snapshot: FormSnapshot;
      } => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return { ok: false, error: 'Title is required' };
    }
    const parsedTrackNo = trackNo.trim() ? Number(trackNo.trim()) : null;
    if (
      trackNo.trim() &&
      (!Number.isInteger(parsedTrackNo) || (parsedTrackNo ?? 0) <= 0)
    ) {
      return { ok: false, error: 'Track number must be a positive integer' };
    }
    const parsedYear = year.trim() ? Number(year.trim()) : null;
    if (
      year.trim() &&
      (!Number.isInteger(parsedYear) ||
        (parsedYear ?? 0) <= 0 ||
        (parsedYear ?? 0) > 9999)
    ) {
      return { ok: false, error: 'Year must be a valid four-digit year' };
    }
    const trimOrNull = (value: string) => {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };
    return {
      ok: true,
      payload: {
        title: trimmedTitle,
        artist: trimOrNull(artist),
        album: trimOrNull(album),
        albumArtist: trimOrNull(albumArtist),
        trackNo: parsedTrackNo,
        year: parsedYear,
        genres: genres
          .split(',')
          .map((genre) => genre.trim())
          .filter(Boolean),
        rating,
        musicbrainzArtistId: trimOrNull(musicbrainzArtistId),
        musicbrainzRecordingId: trimOrNull(musicbrainzRecordingId),
        musicbrainzReleaseId: trimOrNull(musicbrainzReleaseId),
        isrc: trimOrNull(isrc),
      },
      snapshot: currentSnapshot(
        trimmedTitle,
        artist.trim(),
        album.trim(),
        albumArtist.trim(),
        trackNo.trim(),
        year.trim(),
        genres,
        rating,
        musicbrainzArtistId.trim(),
        musicbrainzRecordingId.trim(),
        musicbrainzReleaseId.trim(),
        isrc.trim(),
      ),
    };
  };

  const validateMoveFields = (): string[] => {
    const errors: string[] = [];
    if (state.settings.libraryPaths.length === 0) {
      errors.push('Configure a main library folder in Settings');
    }
    if (!title.trim()) {
      errors.push('Title is required to move the file');
    }
    if (album.trim() && !year.trim()) {
      errors.push('Year is required when an album is set');
    }
    return errors;
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!track || phase !== 'ready') {
      return;
    }
    const parsed = parseSaveFields();
    if (!parsed.ok) {
      setError(parsed.error);
      setSaveError(null);
      return;
    }

    setSaving(true);
    setError(null);
    setSaveError(null);
    setMoveFieldErrors([]);
    try {
      const updated = await api.updateTrackMetadata(track.id, parsed.payload);
      setSavedBaseline(parsed.snapshot);
      onSaved?.(updated);
    } catch (err) {
      setSaveError(saveFailureMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const runMetadataSearch = async () => {
    if (!track || dirty) {
      return;
    }
    const ids =
      selectedProviders.length > 0 ? selectedProviders : defaultSearchProviders;
    if (ids.length === 0) {
      setError('Configure and test at least one metadata provider in Settings.');
      return;
    }
    setCompareMode(true);
    setSearchPhase('searching');
    setError(null);
    setHits([]);
    setHitIndex(0);
    const tried: MetadataProviderTriedDto[] = [];
    const trimmedQuery = searchQuery.trim();
    try {
      for (const id of ids) {
        setTryingProvider(id);
        const result = await api.searchTrackMetadata(track.id, {
          query: trimmedQuery || undefined,
          providerIds: [id],
        });
        tried.push(...result.triedProviders);
        setTriedProviders([...tried]);
        if (result.hits.length > 0) {
          setHits(result.hits);
          setHitIndex(0);
          break;
        }
      }
      setSearchPhase('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSearchPhase('done');
    } finally {
      setTryingProvider(null);
    }
  };

  const currentHit = hits[hitIndex] ?? null;

  const applyFieldFromHit = (key: keyof FormSnapshot) => {
    if (!currentHit) {
      return;
    }
    const values = hitToFormValues(currentHit);
    const value = values[key];
    if (value === undefined) {
      return;
    }
    switch (key) {
      case 'title':
        setTitle(String(value));
        break;
      case 'artist':
        setArtist(String(value));
        break;
      case 'album':
        setAlbum(String(value));
        break;
      case 'albumArtist':
        setAlbumArtist(String(value));
        break;
      case 'trackNo':
        setTrackNo(String(value));
        break;
      case 'year':
        setYear(String(value));
        break;
      case 'genres':
        setGenres(String(value));
        break;
      case 'musicbrainzArtistId':
        setMusicbrainzArtistId(String(value));
        break;
      case 'musicbrainzRecordingId':
        setMusicbrainzRecordingId(String(value));
        break;
      case 'musicbrainzReleaseId':
        setMusicbrainzReleaseId(String(value));
        break;
      case 'isrc':
        setIsrc(String(value));
        break;
      default:
        break;
    }
  };

  const applyAllFromHit = () => {
    if (!currentHit) {
      return;
    }
    const values = hitToFormValues(currentHit);
    if (values.title) setTitle(values.title);
    if (values.artist !== undefined) setArtist(values.artist);
    if (values.album !== undefined) setAlbum(values.album);
    if (values.albumArtist !== undefined) setAlbumArtist(values.albumArtist);
    if (values.trackNo !== undefined) setTrackNo(values.trackNo);
    if (values.year !== undefined) setYear(values.year);
    if (values.genres !== undefined) setGenres(values.genres);
    if (values.musicbrainzArtistId !== undefined) {
      setMusicbrainzArtistId(values.musicbrainzArtistId);
    }
    if (values.musicbrainzRecordingId !== undefined) {
      setMusicbrainzRecordingId(values.musicbrainzRecordingId);
    }
    if (values.musicbrainzReleaseId !== undefined) {
      setMusicbrainzReleaseId(values.musicbrainzReleaseId);
    }
    if (values.isrc !== undefined) setIsrc(values.isrc);
  };

  const toggleProvider = (id: MetadataSearchProviderId) => {
    setSelectedProviders((prev) =>
      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id],
    );
  };

  const startMove = async () => {
    if (!track || phase !== 'ready') {
      return;
    }
    if (dirty) {
      setError('Save metadata before moving the file');
      return;
    }
    const moveErrors = validateMoveFields();
    if (moveErrors.length > 0) {
      setMoveFieldErrors(moveErrors);
      setError(null);
      return;
    }
    setMoveFieldErrors([]);
    setError(null);
    try {
      const preview = await api.previewTrackMove(track.id);
      setMovePreview(preview);
      setMovePhase('confirm');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const confirmMove = async () => {
    if (!track || !movePreview) {
      return;
    }
    setMovePhase('moving');
    setError(null);
    try {
      const updated = await api.executeTrackMove(track.id, { removeEmptyDirs });
      onSaved?.(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMovePhase('confirm');
    }
  };

  const trackLabel = track
    ? [track.artist, track.title].filter(Boolean).join(' — ')
    : '';

  const modalTitle =
    movePhase === 'confirm'
      ? 'Move file'
      : compareMode
        ? 'Compare metadata'
        : 'Edit metadata';

  const moving = movePhase === 'moving';
  const busy = saving || moving || searchPhase === 'searching';

  const hitSnapshot: FormSnapshot | null = currentHit
    ? ({
        ...formSnapshot,
        ...hitToFormValues(currentHit),
        rating: formSnapshot.rating,
      } as FormSnapshot)
    : null;

  const applyFields = COMPARE_FIELDS.filter((f) => !f.skipInApply);
  const isFieldApplied = (key: keyof FormSnapshot): boolean =>
    hitSnapshot != null && formSnapshot[key] === hitSnapshot[key];
  const allFieldsApplied =
    hitSnapshot != null && applyFields.every(({ key }) => isFieldApplied(key));

  const durationCompareState = metadataDurationCompareState(
    durationMs,
    currentHit?.durationMs ?? null,
  );
  const durationCellTone =
    durationCompareState === 'match'
      ? 'metadata-compare-duration-match'
      : durationCompareState === 'mismatch'
        ? 'metadata-compare-duration-mismatch'
        : undefined;

  return (
    <ModalDialog
      open={open}
      title={modalTitle}
      onClose={onClose}
      closeOnBackdropClick={closeOnBackdropClick}
      closeDisabled={busy}
      panelClassName={
        compareMode ? 'modal-panel-tall modal-panel-metadata-compare' : 'modal-panel-tall'
      }
      as={movePhase === 'confirm' ? 'div' : 'form'}
      onSubmit={
        movePhase === 'confirm'
          ? undefined
          : (event) => void handleSave(event)
      }
    >
      {saveError ? (
        <p ref={saveErrorRef} className="metadata-save-error" role="alert">
          {saveError}
        </p>
      ) : null}
      {(movePhase === 'confirm' || movePhase === 'moving') && movePreview ? (
        <>
          <div className="modal-body">
            <p>Move this file to the library layout?</p>
            <dl className="move-path-preview">
              <div>
                <dt>From</dt>
                <dd>{movePreview.fromAbsolute}</dd>
              </div>
              <div>
                <dt>To</dt>
                <dd>{movePreview.toAbsolute}</dd>
              </div>
            </dl>
            {movePreview.conflict ? (
              <p className="settings-feedback warn">
                A file already exists at the destination. The file will be
                renamed with a numeric suffix.
              </p>
            ) : null}
            {movePreview.sidecars.length > 0 ? (
              <p className="lyric-search-hint">
                Sidecar files will move with the audio: {movePreview.sidecars.length}
              </p>
            ) : null}
            <label className="move-cleanup-choice">
              <input
                type="checkbox"
                checked={removeEmptyDirs}
                onChange={(event) => setRemoveEmptyDirs(event.target.checked)}
              />
              Remove empty folders left behind
            </label>
          </div>
          {error ? <p className="lyric-search-error">{error}</p> : null}
          <div className="modal-actions">
            <button
              type="button"
              onClick={() => {
                setMovePhase('idle');
                setMovePreview(null);
              }}
              disabled={moving}
            >
              Back
            </button>
            <button
              type="button"
              className="modal-primary"
              onClick={() => void confirmMove()}
              disabled={moving}
            >
              {moving ? (
                <ProcessingText>Moving…</ProcessingText>
              ) : (
                'Confirm move'
              )}
            </button>
          </div>
        </>
      ) : compareMode ? (
        <>
          <div className="modal-body">
            <p className="lyric-search-hint">
              Left: tags on disk when search started (save before searching).
              Right: online result. Applying updates the edit form only.
            </p>
            <div className="metadata-search-setup">
              <label>
                Search query
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </label>
              <fieldset className="metadata-provider-picks">
                <legend>Providers</legend>
                {defaultSearchProviders.map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={selectedProviders.includes(id)}
                      onChange={() => toggleProvider(id)}
                    />
                    {PROVIDER_LABELS[id]}
                  </label>
                ))}
              </fieldset>
              <button
                type="button"
                disabled={searchPhase === 'searching' || dirty}
                onClick={() => void runMetadataSearch()}
              >
                {searchPhase === 'searching' ? (
                  <ProcessingText>Searching…</ProcessingText>
                ) : (
                  'Search again'
                )}
              </button>
            </div>
            <ul className="metadata-search-progress">
              {tryingProvider ? (
                <li>
                  <ProcessingText>
                    Trying {PROVIDER_LABELS[tryingProvider]}…
                  </ProcessingText>
                </li>
              ) : null}
              {triedProviders.map((entry) => (
                <li key={`${entry.id}-${entry.status}-${entry.message ?? ''}`}>
                  {entry.label}:{' '}
                  {entry.status === 'ok'
                    ? entry.message ?? 'Results found'
                    : entry.status === 'no_results'
                      ? 'No results'
                      : entry.status === 'error'
                        ? `Error — ${entry.message ?? 'failed'}`
                        : entry.message ?? entry.status}
                </li>
              ))}
            </ul>
          </div>
          {diskSnapshot && (
            <div className="metadata-compare">
              {currentHit ? (
                <div className="metadata-compare-toolbar">
                  <p className="lyric-search-hint metadata-compare-source">
                    {currentHit.providerLabel}
                    {currentHit.externalUrl ? (
                      <>
                        {' '}
                        ·{' '}
                        <a
                          href={currentHit.externalUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open
                        </a>
                      </>
                    ) : null}
                  </p>
                  {hits.length > 1 ? (
                    <div className="metadata-result-nav">
                      <button
                        type="button"
                        disabled={hitIndex <= 0}
                        onClick={() => setHitIndex((i) => Math.max(0, i - 1))}
                      >
                        Previous
                      </button>
                      <span>
                        Result {hitIndex + 1} of {hits.length}
                      </span>
                      <button
                        type="button"
                        disabled={hitIndex >= hits.length - 1}
                        onClick={() =>
                          setHitIndex((i) => Math.min(hits.length - 1, i + 1))
                        }
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : searchPhase === 'done' ? (
                <p className="lyric-search-hint">
                  No results. Adjust the query or providers and search again.
                </p>
              ) : null}
              <div className="metadata-compare-table" role="table">
                <div className="metadata-compare-row metadata-compare-header" role="row">
                  <div className="metadata-compare-label" role="columnheader" />
                  <div role="columnheader">On disk</div>
                  <div role="columnheader">Search result</div>
                  <div className="metadata-compare-action" role="columnheader" />
                </div>
                <div className="metadata-compare-row metadata-compare-duration" role="row">
                  <div className="metadata-compare-label" role="rowheader">
                    Duration
                    {durationCompareState === 'match' ? (
                      <span className="lyric-search-duration-badge metadata-compare-duration-badge">
                        Duration match
                      </span>
                    ) : null}
                  </div>
                  <div
                    className={[
                      'metadata-compare-disk',
                      durationCellTone,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    role="cell"
                  >
                    {formatCompareDuration(durationMs)}
                  </div>
                  <div
                    className={[
                      'metadata-compare-hit',
                      durationCellTone,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    role="cell"
                  >
                    {formatCompareDuration(currentHit?.durationMs ?? null)}
                  </div>
                  <div className="metadata-compare-action" role="cell" aria-hidden />
                </div>
                {COMPARE_FIELDS.map(({ key, label, skipInApply }) => {
                  const canApply = !skipInApply && currentHit != null;
                  const applied = canApply && isFieldApplied(key);
                  return (
                    <div key={key} className="metadata-compare-row" role="row">
                      <div className="metadata-compare-label" role="rowheader">
                        {label}
                      </div>
                      <div className="metadata-compare-disk" role="cell">
                        {displayValue(diskSnapshot, key)}
                      </div>
                      <div className="metadata-compare-hit" role="cell">
                        {hitSnapshot
                          ? displayValue(hitSnapshot, key)
                          : '—'}
                      </div>
                      <div className="metadata-compare-action" role="cell">
                        {canApply ? (
                          <button
                            type="button"
                            className={
                              applied ? 'metadata-use-applied' : undefined
                            }
                            aria-pressed={applied}
                            onClick={() => applyFieldFromHit(key)}
                          >
                            Use
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {currentHit ? (
                <button
                  type="button"
                  className={
                    allFieldsApplied
                      ? 'metadata-use-applied metadata-compare-apply-all'
                      : 'metadata-compare-apply-all'
                  }
                  aria-pressed={allFieldsApplied}
                  onClick={() => applyAllFromHit()}
                >
                  Apply all of this result
                </button>
              ) : null}
            </div>
          )}
          {error ? <p className="lyric-search-error">{error}</p> : null}
          <div className="modal-actions">
            <button
              type="button"
              onClick={() => setCompareMode(false)}
              disabled={busy}
            >
              Back to editor
            </button>
            <button type="submit" className="modal-primary" disabled={busy}>
              {saving ? 'Saving…' : 'Save metadata'}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="modal-body">
            {track && (
              <p>
                Editing tags for <strong>{trackLabel}</strong>
                {durationMs != null ? ` · ${formatDuration(durationMs)}` : null}
              </p>
            )}
            {dirty ? (
              <p className="lyric-search-hint">
                Save metadata before searching online or using Move to library
                layout.
              </p>
            ) : null}
          </div>

          {phase === 'loading' && (
            <p className="lyric-search-hint">
              <ProcessingText>Reading tags from file…</ProcessingText>
            </p>
          )}

          {phase === 'ready' && (
            <div className="metadata-form">
              <label>
                Title
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  required
                  aria-invalid={moveFieldErrors.some((e) => e.includes('Title'))}
                />
              </label>
              <label>
                Artist
                <input
                  type="text"
                  value={artist}
                  onChange={(event) => setArtist(event.target.value)}
                />
              </label>
              <label>
                Album
                <input
                  type="text"
                  value={album}
                  onChange={(event) => setAlbum(event.target.value)}
                />
              </label>
              <label>
                Album artist
                <input
                  type="text"
                  value={albumArtist}
                  onChange={(event) => setAlbumArtist(event.target.value)}
                />
              </label>
              <label>
                Track number
                <input
                  type="number"
                  min={1}
                  value={trackNo}
                  onChange={(event) => setTrackNo(event.target.value)}
                />
              </label>
              <label>
                Year
                <input
                  type="number"
                  min={1}
                  max={9999}
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                  aria-invalid={moveFieldErrors.some((e) =>
                    e.includes('Year'),
                  )}
                />
              </label>
              <label>
                Genres
                <input
                  type="text"
                  value={genres}
                  onChange={(event) => setGenres(event.target.value)}
                  placeholder="Pop, Rock"
                />
              </label>
              <label>
                MusicBrainz artist ID
                <input
                  type="text"
                  value={musicbrainzArtistId}
                  onChange={(event) => setMusicbrainzArtistId(event.target.value)}
                />
              </label>
              <label>
                MusicBrainz recording ID
                <input
                  type="text"
                  value={musicbrainzRecordingId}
                  onChange={(event) =>
                    setMusicbrainzRecordingId(event.target.value)
                  }
                />
              </label>
              <label>
                MusicBrainz release ID
                <input
                  type="text"
                  value={musicbrainzReleaseId}
                  onChange={(event) => setMusicbrainzReleaseId(event.target.value)}
                />
              </label>
              <label>
                ISRC
                <input
                  type="text"
                  value={isrc}
                  onChange={(event) => setIsrc(event.target.value)}
                />
              </label>
              <div className="metadata-rating">
                <span>Rating</span>
                <StarRating
                  value={rating}
                  ariaLabel={`Rate ${title || track?.title || 'track'}`}
                  onConfirm={setRating}
                />
              </div>
            </div>
          )}

          {moveFieldErrors.length > 0 ? (
            <ul className="lyric-search-error">
              {moveFieldErrors.map((msg) => (
                <li key={msg}>{msg}</li>
              ))}
            </ul>
          ) : null}
          {error ? <p className="lyric-search-error">{error}</p> : null}

          <div className="modal-actions">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              disabled={phase !== 'ready' || busy || dirty}
              title={dirty ? 'Save or revert changes before searching' : undefined}
              onClick={() => {
                setCompareMode(true);
                void runMetadataSearch();
              }}
            >
              Search metadata
            </button>
            <button
              type="button"
              disabled={phase !== 'ready' || busy || dirty}
              onClick={() => void startMove()}
            >
              Move to library layout
            </button>
            <button
              type="submit"
              className="modal-primary"
              disabled={phase !== 'ready' || busy}
            >
              {saving ? 'Saving…' : 'Save metadata'}
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}

