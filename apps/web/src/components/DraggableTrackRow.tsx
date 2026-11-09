import { useDraggable } from '@dnd-kit/core';
import { FiFolderMinus, FiMove, FiPause, FiPlay, FiTag } from 'react-icons/fi';
import { TrackDto } from '@karaokej/shared';
import { api } from '../api';
import { trackDragId } from '../dnd/dragIds';
import { formatDuration, karaokeStemBadge } from '../format';
import { useSession } from '../session/SessionProvider';
import { CoverArt } from './CoverArt';
import { IconMenu } from './IconMenu';
import { LyricStatusBadge } from './LyricStatusBadge';
import { ProcessingText } from './ProcessingText';
import { StarRating } from './StarRating';
import { isInteractiveTrackTarget, TrackMain } from './TrackMain';

interface DraggableTrackRowProps {
  track: TrackDto;
  selected: boolean;
  batchDragging: boolean;
  batchTrackIds: number[];
  fetching: boolean;
  onFetchLyrics: (trackId: number) => void;
  onRate: (trackId: number, rating: number) => void;
  onApplySearchTerm: (term: string) => void;
  onPlay: (track: TrackDto) => void;
  onEditMetadata: (track: TrackDto) => void;
  onRemoveAiStem: (track: TrackDto) => void;
  onDeleteFile: (track: TrackDto) => void;
  onShowCover: (track: TrackDto) => void;
  onManageTags: (track: TrackDto) => void;
  onToggleSelect: (track: TrackDto) => void;
  showTrackNo?: boolean;
}

export function DraggableTrackRow({
  track,
  selected,
  batchDragging,
  batchTrackIds,
  fetching,
  onFetchLyrics,
  onRate,
  onApplySearchTerm,
  onPlay,
  onEditMetadata,
  onRemoveAiStem,
  onDeleteFile,
  onShowCover,
  onManageTags,
  onToggleSelect,
  showTrackNo = false,
}: DraggableTrackRowProps) {
  const { state } = useSession();
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: trackDragId(track.id),
    data: { kind: 'track', track, trackIds: batchTrackIds },
  });
  const showDragging = isDragging || batchDragging;
  const stemBadge = karaokeStemBadge(track.karaokeStemStatus);
  const tagsPending = track.metadataStatus === 'pending';
  const PlacementIcon =
    track.libraryPlacement === 'outside_main'
      ? FiFolderMinus
      : track.libraryPlacement === 'in_main_unsorted'
        ? FiMove
        : null;
  const placementTitle =
    track.libraryPlacement === 'outside_main'
      ? 'Outside main library — click to edit metadata'
      : track.libraryPlacement === 'in_main_unsorted'
        ? 'Not in main library layout — click to edit metadata'
        : null;
  const placementLabel =
    track.libraryPlacement === 'outside_main'
      ? 'Outside main library'
      : track.libraryPlacement === 'in_main_unsorted'
        ? 'Not in main library layout'
        : null;
  const isCurrentPlaying =
    state.playback.status === 'playing' &&
    state.playback.currentTrack?.id === track.id;

  const copyFilePath = async () => {
    const { path } = await api.trackPath(track.id);
    await navigator.clipboard.writeText(path);
  };

  return (
    <li
      ref={setNodeRef}
      className={`${selected ? 'selected' : ''}${showDragging ? ' dragging' : ''}`.trim() || undefined}
      onClick={(event) => {
        if (event.detail > 1) {
          return;
        }
        if (isInteractiveTrackTarget(event.target)) {
          return;
        }
        onToggleSelect(track);
      }}
      onDoubleClick={(event) => {
        if (isInteractiveTrackTarget(event.target)) {
          return;
        }
        onPlay(track);
      }}
    >
      <CoverArt
        track={track}
        size={48}
        fillRow={track.tags.length > 0}
        onClick={() => onShowCover(track)}
      />
      <TrackMain
        track={track}
        title="Drag to add to queue"
        showTrackNo={showTrackNo}
        onApplySearchTerm={onApplySearchTerm}
        {...listeners}
      />
      <div className="track-meta">
        <LyricStatusBadge
          status={track.lyricStatus}
          fetching={fetching}
          onFetch={() => onFetchLyrics(track.id)}
        />
        {PlacementIcon && placementTitle && placementLabel ? (
          <button
            type="button"
            className="status-icon warn"
            title={placementTitle}
            aria-label={placementLabel}
            onClick={() => onEditMetadata(track)}
          >
            <PlacementIcon aria-hidden />
          </button>
        ) : null}
        {tagsPending ? (
          <span
            className="status-icon warn"
            title="Filename only; tags not read yet"
            aria-label="Tags pending"
          >
            <FiTag aria-hidden />
          </span>
        ) : null}
        {stemBadge ? (
          <span className={`badge ${stemBadge.tone}`} title={stemBadge.title}>
            {stemBadge.processing ? (
              <ProcessingText>{stemBadge.label}</ProcessingText>
            ) : (
              stemBadge.label
            )}
          </span>
        ) : null}
        <span className="time">{formatDuration(track.durationMs)}</span>
        <StarRating
          value={track.rating}
          compact
          ariaLabel={`Rate ${track.title}`}
          onConfirm={(rating) => onRate(track.id, rating)}
        />
        <button
          type="button"
          className={`icon-btn${isCurrentPlaying ? ' play-live' : ''}`}
          title={isCurrentPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
          aria-label={isCurrentPlaying ? `Pause ${track.title}` : `Play ${track.title}`}
          onClick={() => {
            if (isCurrentPlaying) {
              void api.pause();
              return;
            }
            onPlay(track);
          }}
        >
          {isCurrentPlaying ? <FiPause aria-hidden /> : <FiPlay aria-hidden />}
        </button>
        <IconMenu
          ariaLabel={`Actions for ${track.title}`}
          items={[
            {
              id: 'edit-metadata',
              label: 'Edit metadata',
              onSelect: () => onEditMetadata(track),
            },
            {
              id: 'manage-tags',
              label: 'Manage tags',
              onSelect: () => onManageTags(track),
            },
            {
              id: 'artist-bio',
              label: 'Artist bio',
              onSelect: () => onShowCover(track),
            },
            {
              id: 'copy-file-path',
              label: 'Copy file path',
              onSelect: copyFilePath,
            },
            ...(track.karaokeStemStatus === 'ready'
              ? [
                  {
                    id: 'remove-ai-stem',
                    label: 'Remove AI stem',
                    onSelect: () => onRemoveAiStem(track),
                  },
                ]
              : []),
            {
              id: 'delete-file',
              label: 'Delete file',
              variant: 'danger' as const,
              onSelect: () => onDeleteFile(track),
            },
          ]}
        />
      </div>
    </li>
  );
}
