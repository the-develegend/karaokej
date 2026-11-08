import { Link } from 'react-router-dom';
import { JobStatusDto, LibraryStatusDto } from '@karaokej/shared';
import { formatRelativeScanTime } from '../format';
import { ModalDialog } from './ModalDialog';
import { ProcessingText } from './ProcessingText';

interface ScanModalProps {
  open: boolean;
  status: LibraryStatusDto | null;
  scan: JobStatusDto;
  lyricsFetch: JobStatusDto;
  download: JobStatusDto;
  covers: JobStatusDto;
  onClose: () => void;
  onScan: () => void;
  onRefreshScan: () => void;
  onFetchLyrics: () => void;
  onCreateThumbnails: () => void;
}

export function ScanModal({
  open,
  status,
  scan,
  lyricsFetch,
  download,
  covers,
  onClose,
  onScan,
  onRefreshScan,
  onFetchLyrics,
  onCreateThumbnails,
}: ScanModalProps) {
  const scanProgress =
    scan.running && scan.total > 0
      ? Math.min(100, Math.round((scan.current / scan.total) * 100))
      : null;

  return (
    <ModalDialog
      open={open}
      title="Scan"
      onClose={onClose}
      panelClassName="scan-modal-panel"
    >
      <div className="scan-modal-actions">
        <button
          type="button"
          disabled={!scan.running && !status?.libraryConfigured}
          onClick={onScan}
        >
          {scan.running ? 'Cancel scan' : 'Scan library'}
        </button>
        {scan.running ? (
          <button type="button" onClick={onRefreshScan}>
            Check scan
          </button>
        ) : null}
        <button
          type="button"
          disabled={!lyricsFetch.running && (status?.trackCount ?? 0) === 0}
          onClick={onFetchLyrics}
        >
          {lyricsFetch.running ? 'Cancel lyrics' : 'Fetch missing lyrics'}
        </button>
        <button
          type="button"
          disabled={!covers.running && (status?.trackCount ?? 0) === 0}
          onClick={onCreateThumbnails}
        >
          {covers.running ? 'Cancel thumbnails' : 'Create thumbnails'}
        </button>
      </div>
      <div className="toolbar-status scan-modal-status">
        <p className="status-copy">
          {status?.libraryConfigured ? (
            <>
              {status.trackCount} tracks · {status.withLyrics} with lyrics · Last
              full scan: {formatRelativeScanTime(status.lastFullScanAt)}
              {status.rebasePending ? (
                <>
                  {' '}
                  · Library folders changed —{' '}
                  <Link to="/settings">Apply / Rebase on Settings</Link> before
                  scanning.
                </>
              ) : null}
              {(status.invalidLibraryPaths?.length ?? 0) > 0 ? (
                <>
                  {' '}
                  · Some saved folders are unreachable (
                  {status.invalidLibraryPaths.length}).
                </>
              ) : null}
            </>
          ) : (
            <>
              No library folders configured.{' '}
              <Link to="/settings">Set library folders on Settings</Link>, then
              scan.
            </>
          )}
          {scan.message ? (
            <>
              {' · '}
              {scan.running ? (
                <ProcessingText>{scan.message}</ProcessingText>
              ) : (
                scan.message
              )}
            </>
          ) : null}
          {lyricsFetch.running && lyricsFetch.message ? (
            <>
              {' · '}
              <ProcessingText>{lyricsFetch.message}</ProcessingText>
            </>
          ) : null}
          {download.running && download.message ? (
            <>
              {' · '}
              <ProcessingText>{download.message}</ProcessingText>
            </>
          ) : null}
          {covers.running && covers.message ? (
            <>
              {' · '}
              <ProcessingText>{covers.message}</ProcessingText>
            </>
          ) : null}
        </p>
        {scan.running ? (
          <div
            className={`scan-progress${scanProgress == null ? ' scan-progress-indeterminate' : ''}`}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={scanProgress ?? undefined}
            aria-label="Library scan progress"
          >
            <span
              className="scan-progress-bar"
              style={scanProgress == null ? undefined : { width: `${scanProgress}%` }}
            />
          </div>
        ) : null}
      </div>
    </ModalDialog>
  );
}
