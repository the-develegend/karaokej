import { AudioFormat } from '@karaokej/shared';

export interface WalkErrorReport {
  path: string;
  op: 'readdir' | 'stat' | 'exists' | 'parse';
  message: string;
}

export interface ParsedTrackMetadata {
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  durationMs: number | null;
  rating: number;
  year: number | null;
  genres: string[];
  musicbrainzArtistId: string | null;
  musicbrainzRecordingId: string | null;
  musicbrainzReleaseId: string | null;
  isrc: string | null;
  /** Raw Mood values from the file, before name rules. */
  moodValues: string[];
}

export interface ScanChunkItem {
  absolutePath: string;
  relativePath: string;
  sizeBytes: number;
  mtimeMs: number;
  format: AudioFormat;
  unchanged: boolean;
  hasLrc: boolean | null;
  metadata: ParsedTrackMetadata | null;
}

export interface ScanChunkStats {
  parsed: number;
  unchanged: number;
}

export interface ScanWorkerStartPayload {
  root: string;
  chunkSize: number;
  metadataConcurrency: number;
  walkConcurrency: number;
  fsTimeoutMs: number;
  skipLrcOnUnchanged: boolean;
  skipUnchangedDirs: boolean;
  completedGroups: string[];
  existingByPath: Record<string, { size_bytes: number; mtime_ms: number }>;
  dirMtimes: Record<string, number>;
}

export type ScanWorkerToHostMessage =
  | { type: 'progress'; processed: number; folder: { label: string; groupId: string; index: number; total: number; resuming?: boolean } }
  | {
      type: 'chunk';
      groupId: string;
      items: ScanChunkItem[];
      folderComplete: boolean;
      stats: ScanChunkStats;
    }
  | { type: 'dirStat'; relativePath: string; mtimeMs: number }
  | { type: 'walkError'; error: WalkErrorReport }
  | { type: 'dirSkipped'; groupId: string; seenPaths: string[] }
  | { type: 'done'; processed: number; skippedDirs: number }
  | { type: 'failed'; message: string };

export type ScanWorkerFromHostMessage =
  | { type: 'start'; payload: ScanWorkerStartPayload }
  | { type: 'cancel' };
