import { ModalDialog } from './ModalDialog';

interface PlayTrackModalProps {
  open: boolean;
  trackTitle: string;
  songCount?: number;
  onPlayNow: () => void;
  onQueueAtEnd: () => void;
  onQueueAfterCurrent: () => void;
  onCancel: () => void;
  closeOnBackdropClick?: boolean;
}

export function PlayTrackModal({
  open,
  trackTitle,
  songCount = 1,
  onPlayNow,
  onQueueAtEnd,
  onQueueAfterCurrent,
  onCancel,
  closeOnBackdropClick,
}: PlayTrackModalProps) {
  const multi = songCount > 1;

  return (
    <ModalDialog
      open={open}
      title={multi ? 'Play songs' : 'Play song'}
      onClose={onCancel}
      closeOnBackdropClick={closeOnBackdropClick}
    >
      <div className="modal-body">
        {multi ? (
          <>
            <p>
              These songs are ready, but another song is playing. Play the first now and queue the
              rest after it, queue them after the current song, or add them to the end of the
              playlist?
            </p>
            <p className="modal-hint">This will add {songCount} songs.</p>
          </>
        ) : (
          <p>
            <strong>{trackTitle}</strong> is ready, but another song is playing. Play it now, queue
            it after the current song, or add it to the end of the playlist?
          </p>
        )}
      </div>
      <div className="modal-actions modal-actions-multi">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onQueueAfterCurrent}>
          After current song
        </button>
        <button type="button" onClick={onQueueAtEnd}>
          Queue at end
        </button>
        <button type="button" className="modal-primary" onClick={onPlayNow}>
          Play now
        </button>
      </div>
    </ModalDialog>
  );
}
