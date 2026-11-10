export function formatDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) {
    return '–:––';
  }
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Clock duration for accumulated totals; includes hours when needed. */
export function formatClockDuration(ms: number | null | undefined): string {
  if (!ms || ms < 0) {
    return '–:––';
  }
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatAccumulatedDuration({
  totalMs,
  unknownCount,
}: {
  totalMs: number;
  unknownCount: number;
}): string | null {
  if (totalMs <= 0 && unknownCount <= 0) {
    return null;
  }
  const base = totalMs > 0 ? formatClockDuration(totalMs) : '–:––';
  if (unknownCount > 0) {
    return `${base} + ?`;
  }
  return base;
}

export const LYRIC_DURATION_MATCH_TOLERANCE_MS = 2000;

export function lyricDurationMatches(
  trackDurationMs: number | null | undefined,
  hitDurationMs: number | null | undefined,
): boolean {
  if (trackDurationMs == null || hitDurationMs == null) {
    return false;
  }
  return Math.abs(hitDurationMs - trackDurationMs) <= LYRIC_DURATION_MATCH_TOLERANCE_MS;
}

export type MetadataDurationCompareState = 'unknown' | 'match' | 'mismatch';

export function metadataDurationCompareState(
  trackDurationMs: number | null | undefined,
  hitDurationMs: number | null | undefined,
): MetadataDurationCompareState {
  if (trackDurationMs == null || hitDurationMs == null) {
    return 'unknown';
  }
  return lyricDurationMatches(trackDurationMs, hitDurationMs) ? 'match' : 'mismatch';
}

export function formatCompareDuration(ms: number | null | undefined): string {
  if (ms == null) {
    return '—';
  }
  return formatClockDuration(ms);
}

export type TrackSubtitleSegment =
  | { kind: 'artist'; text: string; searchable: boolean }
  | { kind: 'album'; text: string; searchable: true }
  | { kind: 'year'; text: string }
  | { kind: 'genres'; text: string }
  | { kind: 'separator'; text: string };

const SUBTITLE_SEPARATOR = ' · ';

function appendSeparator(segments: TrackSubtitleSegment[]): void {
  if (segments.length > 0) {
    segments.push({ kind: 'separator', text: SUBTITLE_SEPARATOR });
  }
}

export function trackSubtitleSegments(track: {
  artist: string | null;
  album: string | null;
  year: number | null;
  genres: string[];
}): TrackSubtitleSegment[] {
  const segments: TrackSubtitleSegment[] = [];

  segments.push({
    kind: 'artist',
    text: track.artist ?? 'Unknown artist',
    searchable: track.artist != null,
  });

  if (track.album) {
    appendSeparator(segments);
    segments.push({ kind: 'album', text: track.album, searchable: true });
    if (track.year != null) {
      segments.push({ kind: 'year', text: ` (${track.year})` });
    }
  } else if (track.year != null) {
    appendSeparator(segments);
    segments.push({ kind: 'year', text: String(track.year) });
  }

  if (track.genres.length > 0) {
    appendSeparator(segments);
    const shown = track.genres.slice(0, 3);
    let genreText = shown.join(', ');
    const remaining = track.genres.length - shown.length;
    if (remaining > 0) {
      genreText += ` +${remaining}`;
    }
    segments.push({ kind: 'genres', text: genreText });
  }

  return segments;
}

export function formatTrackSubtitle(track: {
  artist: string | null;
  album: string | null;
  year: number | null;
  genres: string[];
}): string {
  return trackSubtitleSegments(track)
    .map((segment) => segment.text)
    .join('');
}

export function lyricBadge(status: string): {
  label: string;
  tone: string;
  icon?: 'lyrics';
} {
  switch (status) {
    case 'present':
      return { label: 'Lyrics', tone: 'ok', icon: 'lyrics' };
    case 'instrumental':
      return { label: 'Instrumental', tone: 'muted' };
    case 'not_found':
      return { label: 'No lyrics', tone: 'warn' };
    case 'unavailable':
      return { label: 'Unavailable', tone: 'muted', icon: 'lyrics' };
    case 'error':
      return { label: 'Lyric error', tone: 'warn' };
    default:
      return { label: 'Missing lyrics', tone: 'muted', icon: 'lyrics' };
  }
}

export type KaraokeStemBadge = {
  label: string;
  tone: string;
  show: true;
  title: string;
  processing?: boolean;
};

export function karaokeStemBadge(
  status: string | null | undefined,
): KaraokeStemBadge | null {
  switch (status) {
    case 'ready':
      return {
        label: 'AI stem',
        tone: 'ok',
        show: true,
        title: 'AI instrumental stem is ready',
      };
    case 'pending':
      return {
        label: 'Queued',
        tone: 'muted',
        show: true,
        title: 'Stem separation is queued',
      };
    case 'processing':
      return {
        label: 'Separating…',
        tone: 'warn',
        show: true,
        title: 'Stem separation in progress',
        processing: true,
      };
    default:
      return null;
  }
}

export function formatRelativeScanTime(timestamp: number | null | undefined): string {
  if (!timestamp) {
    return 'Never';
  }
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) {
    return 'Just now';
  }
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
