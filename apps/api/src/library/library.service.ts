import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  JobKind,
  JobStatusDto,
  LibraryRebaseResultDto,
  LibraryScanBodyDto,
  LibraryStatusDto,
  RandomArtistDto,
  ScanIssueDto,
  LibrarySort,
  TrackDto,
  TrackPageDto,
  TrackPathDto,
} from '@karaokej/shared';
import { AppConfigService } from '../config/app-config.service';
import {
  LIBRARY_PATHS_SETTINGS_HINT,
  LIBRARY_REBASE_REQUIRED_HINT,
} from './library-path-messages';
import { validateConfiguredLibraryPaths } from './library-path-validation';
import { DbService } from '../db/db.service';
import { JobRow, TrackRow, trackToDto } from '../db/types';
import { loadStemRowsForTracks, resolveStemStatusForTrack } from '../karaoke/stem-status';
import {
  coverInfoForTrack,
  loadCoverInfoForTrack,
  loadCoverInfoForTracks,
} from '../covers/cover-lookup';
import { coverGroupKey } from '../covers/cover-group-key';
import { pruneOrphanedCoverGroups } from '../covers/cover-storage';
import { SeparationService } from '../karaoke/separation.service';
import { SessionService } from '../session/session.service';
import {
  estimateScanRate,
  formatPhase1ScanMessage,
  formatPhase2ScanMessage,
  formatScanCompleteMessage,
  lyricPathFor,
  makeFingerprint,
  yieldEventLoop,
} from './fs-utils';
import { sanitizeDurationMs } from './duration-utils';
import {
  planMultiRootRebase,
  parseStoredScanRoots,
  serializeStoredScanRoots,
} from './library-rebase';
import {
  buildLibraryPathLayout,
  cataloguePathBelongsToRoot,
  prefixCataloguePath,
  sameRootSet,
  stripCataloguePath,
  type LibraryPathLayout,
} from './library-paths';
import {
  LIBRARY_LAST_FULL_SCAN_AT_KEY,
  LIBRARY_SCAN_CHECKPOINT_KEY,
  LIBRARY_SCAN_ISSUES_KEY,
  MAX_SCAN_ISSUES,
  checkpointMatchesRoots,
  displayScanPath,
  parseScanCheckpoint,
  parseScanIssues,
  seedSeenFromCompletedGroups,
  type ScanCheckpoint,
} from './scan-checkpoint';
import { ScanWorkerHost } from './scan-worker-host';
import type { ScanChunkItem } from './scan-ipc';
import {
  mapWithConcurrency,
  readTrackMetadata,
} from './scan-metadata';
import { resolveReliableDurationMs } from './probe-duration';
import { upsertPathTrack, upsertTagsTrack } from './scan-track-upsert';
import { loadManagedTagNames } from '../tags/tag-cache';

const LIBRARY_SCAN_ROOT_KEY = 'library_scan_root';

const TRACK_SELECT_COLUMNS = `
  id, relative_path, format, size_bytes, mtime_ms, title, artist, album, album_artist,
  track_no, duration_ms, lyric_status, lyric_source, lyric_checked_at, lrclib_id,
  fingerprint, rating, year, genres, metadata_status, cover_group, available, created_at, updated_at
`;

const DEDUPE_PARTITION = `
  CASE
    WHEN metadata_status = 'pending' THEN 'pending:' || relative_path
    ELSE 'ready:' || LOWER(TRIM(COALESCE(artist, ''))) || '|' || LOWER(TRIM(title)) || '|' || CAST(COALESCE(duration_ms, -1) / 2000 AS INTEGER)
  END
`;

const DEDUPE_KEEP_ORDER = `
  CASE WHEN lyric_status = 'present' THEN 0 ELSE 1 END,
  id
`;

/** Unnumbered tracks sort after any real track number. */
const MISSING_TRACK_NO = 999_999;

function trackOrderSql(
  sort: LibrarySort,
  options: { hasQuery: boolean; fts: boolean; qualified: boolean },
): string {
  const col = (name: string) => (options.qualified ? `t.${name}` : name);
  const artist = `${col('artist')} COLLATE NOCASE`;
  const album = `${col('album')} COLLATE NOCASE`;
  const title = `${col('title')} COLLATE NOCASE`;
  const trackNo = `COALESCE(${col('track_no')}, ${MISSING_TRACK_NO})`;
  const id = col('id');
  const effective: LibrarySort =
    !options.hasQuery && sort === 'relevance' ? 'artist' : sort;

  switch (effective) {
    case 'album':
      return `${album}, ${artist}, ${trackNo}, ${title}, ${id}`;
    case 'artist':
      return `${artist}, ${album}, ${trackNo}, ${title}, ${id}`;
    case 'title':
      return `${title}, ${artist}, ${id}`;
    case 'relevance':
      return options.fts
        ? `rank, ${artist}, ${title}, ${id}`
        : `${artist}, ${title}, ${id}`;
  }
}

@Injectable()
export class LibraryService implements OnModuleInit {
  private readonly logger = new Logger(LibraryService.name);
  private scanRunning = false;
  private scanCancelRequested = false;
  private readonly scanWorkerHost = new ScanWorkerHost();
  private readonly durationBackfillInFlight = new Set<number>();

  constructor(
    private readonly db: DbService,
    private readonly config: AppConfigService,
    private readonly session: SessionService,
    private readonly separation: SeparationService,
  ) {}

  onModuleInit(): void {
    this.reconcileScanJob('startup');
  }

  status(): LibraryStatusDto {
    const trackCount = this.db.raw
      .prepare(`SELECT COUNT(*) AS n FROM tracks WHERE available = 1`)
      .get() as { n: number };
    const withLyrics = this.db.raw
      .prepare(
        `SELECT COUNT(*) AS n FROM tracks WHERE available = 1 AND lyric_status = 'present'`,
      )
      .get() as { n: number };
    const configured = this.config.configuredLibraryPaths;
    const pathCheck = validateConfiguredLibraryPaths(
      configured,
      this.config.repoRoot,
    );
    return {
      trackCount: trackCount.n,
      withLyrics: withLyrics.n,
      libraryPaths: this.config.libraryPaths,
      libraryConfigured: configured.length > 0,
      rebasePending: this.isRebasePending(),
      invalidLibraryPaths: pathCheck.invalid,
      lastFullScanAt: this.getLastFullScanAt(),
      scanIssues: this.getScanIssues(),
      scan: this.jobStatus('scan'),
      lyricsFetch: this.jobStatus('lyrics'),
      ytsaverAvailable: existsSync(this.config.ytsaverPath),
      ytsaverPath: this.config.ytsaverPath,
      ytdlpAvailable: existsSync(this.config.ytdlpPath),
      ytdlpPath: this.config.ytdlpPath,
      demucsAvailable: this.config.isDemucsAvailable(),
      demucsPath: this.config.demucsPath,
    };
  }

  jobStatus(kind: JobKind): JobStatusDto {
    const row = this.db.raw
      .prepare(`SELECT * FROM jobs WHERE kind = ?`)
      .get(kind) as JobRow | undefined;
    return {
      kind,
      running: Boolean(row?.running),
      current: row?.current ?? 0,
      total: row?.total ?? 0,
      message: row?.message ?? null,
    };
  }

  setJob(
    kind: JobKind,
    patch: {
      running?: boolean;
      current?: number;
      total?: number;
      message?: string | null;
    },
  ): void {
    const current = this.jobStatus(kind);
    this.db.raw
      .prepare(
        `UPDATE jobs SET running = ?, current = ?, total = ?, message = ?, updated_at = ? WHERE kind = ?`,
      )
      .run(
        Number(patch.running ?? current.running),
        patch.current ?? current.current,
        patch.total ?? current.total,
        patch.message === undefined ? current.message : patch.message,
        Date.now(),
        kind,
      );
    this.session.broadcast();
  }

  getTrack(id: number): TrackRow | undefined {
    return this.db.raw
      .prepare(`SELECT * FROM tracks WHERE id = ?`)
      .get(id) as TrackRow | undefined;
  }

  getTrackDto(id: number): TrackDto | undefined {
    const row = this.getTrack(id);
    if (!row) {
      return undefined;
    }
    return this.tracksToDto([row])[0];
  }

  private tracksToDto(rows: TrackRow[]): TrackDto[] {
    const stemByTrackId = loadStemRowsForTracks(
      this.db.raw,
      rows.map((row) => row.id),
    );
    const coverByGroup = loadCoverInfoForTracks(this.db.raw, rows);
    const tagsByTrack = loadManagedTagNames(
      this.db.raw,
      rows.map((row) => row.id),
    );
    return rows.map((row) =>
      trackToDto(
        row,
        resolveStemStatusForTrack(row, stemByTrackId.get(row.id)),
        coverInfoForTrack(coverByGroup, row),
        tagsByTrack.get(row.id) ?? [],
      ),
    );
  }

  getRandomArtist(exclude?: string): RandomArtistDto {
    const trimmedExclude = exclude?.trim() || null;
    const artist = this.pickRandomArtist(trimmedExclude);
    if (artist) {
      return { artist };
    }
    if (trimmedExclude) {
      const fallback = this.pickRandomArtist(null);
      if (fallback) {
        return { artist: fallback };
      }
    }
    throw new NotFoundException('No artists found in library');
  }

  private pickRandomArtist(exclude: string | null): string | null {
    const row = this.db.raw
      .prepare(
        `SELECT artist
         FROM tracks
         WHERE available = 1
           AND artist IS NOT NULL
           AND TRIM(artist) != ''
           AND (? IS NULL OR LOWER(TRIM(artist)) != LOWER(?))
         GROUP BY LOWER(TRIM(artist))
         ORDER BY RANDOM()
         LIMIT 1`,
      )
      .get(exclude, exclude) as { artist: string } | undefined;
    return row?.artist ?? null;
  }

  getTrackPath(id: number): TrackPathDto {
    const track = this.getTrack(id);
    if (!track) {
      throw new NotFoundException('Track not found');
    }
    const absolute = this.config.resolveUnderLibrary(track.relative_path);
    if (!absolute) {
      throw new BadRequestException('Track path is unavailable');
    }
    return { path: absolute };
  }

  deleteTrackFile(trackId: number): void {
    const track = this.getTrack(trackId);
    if (!track || track.available !== 1) {
      throw new NotFoundException('Track not found');
    }

    if (this.separation.getProcessingTrackId() === trackId) {
      throw new ConflictException(
        'Cannot delete track while AI separation is in progress',
      );
    }

    const absolute = this.config.resolveUnderLibrary(track.relative_path);
    if (!absolute) {
      throw new BadRequestException('Track path is outside the music library');
    }

    try {
      this.separation.remove(trackId);
    } catch (err) {
      if (!(err instanceof NotFoundException)) {
        throw err;
      }
    }

    if (existsSync(absolute)) {
      try {
        unlinkSync(absolute);
      } catch (err) {
        this.logger.warn(
          `Failed to delete audio file ${absolute}: ${err instanceof Error ? err.message : err}`,
        );
        throw new BadRequestException('Failed to delete audio file from disk');
      }
    }

    const lrcPath = lyricPathFor(absolute);
    if (existsSync(lrcPath)) {
      try {
        unlinkSync(lrcPath);
      } catch (err) {
        this.logger.warn(
          `Failed to delete lyrics file ${lrcPath}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    const queueRows = this.db.raw
      .prepare(`SELECT id FROM queue_items WHERE track_id = ?`)
      .all(trackId) as Array<{ id: number }>;
    const deletedQueueItemIds = new Set(queueRows.map((row) => row.id));
    const playback = this.db.raw
      .prepare(`SELECT current_queue_item_id FROM playback_state WHERE id = 1`)
      .get() as { current_queue_item_id: number | null };
    const currentQueueRemoved =
      playback.current_queue_item_id != null &&
      deletedQueueItemIds.has(playback.current_queue_item_id);

    const now = Date.now();
    const coverGroup = track.cover_group ?? null;
    const coverCachePath = this.config.coverCachePath;
    const tx = this.db.raw.transaction((id: number) => {
      this.db.raw
        .prepare(`DELETE FROM playlist_items WHERE track_id = ?`)
        .run(id);
      this.db.raw.prepare(`DELETE FROM tracks WHERE id = ?`).run(id);
      if (coverGroup) {
        pruneOrphanedCoverGroups(this.db.raw, coverCachePath, [coverGroup]);
      }
    });
    tx(trackId);

    if (currentQueueRemoved) {
      const first = this.db.raw
        .prepare(
          `SELECT id FROM queue_items ORDER BY position ASC, id ASC LIMIT 1`,
        )
        .get() as { id: number } | undefined;
      this.db.raw
        .prepare(
          `UPDATE playback_state SET current_queue_item_id = ?, status = ?, position_ms = 0, seek_seq = seek_seq + 1, updated_at = ? WHERE id = 1`,
        )
        .run(first?.id ?? null, first ? 'paused' : 'idle', now);
    }

    this.session.broadcast();
  }

  async ingestDownloadedFile(absolutePath: string): Promise<TrackDto> {
    if (!existsSync(absolutePath)) {
      throw new BadRequestException('Downloaded file not found');
    }
    const layout = this.config.libraryLayout;
    const firstRoot = this.requireLibraryRootsForDownload();
    const downloadsDir = join(firstRoot, 'Downloads');
    const normalizedAbsolute = absolutePath.replace(/\\/g, '/');
    const normalizedDownloads = downloadsDir.replace(/\\/g, '/');
    if (
      !normalizedAbsolute.startsWith(`${normalizedDownloads}/`) &&
      normalizedAbsolute !== normalizedDownloads
    ) {
      throw new BadRequestException('File is outside the download folder');
    }

    const relativeUnderRoot = relative(firstRoot, absolutePath).replace(/\\/g, '/');
    const key = layout.keys.get(firstRoot);
    if (!key) {
      throw new BadRequestException('Library root key is unavailable');
    }
    const relativePath = prefixCataloguePath(
      key,
      relativeUnderRoot,
      layout.multiRoot,
    );

    const stat = statSync(absolutePath);
    let hasLrc = false;
    try {
      await access(lyricPathFor(absolutePath), constants.F_OK);
      hasLrc = true;
    } catch {
      hasLrc = false;
    }

    const now = Date.now();
    const pathItem: ScanChunkItem = {
      absolutePath,
      relativePath,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      format: 'mp3',
      unchanged: false,
      hasLrc,
      metadata: null,
    };
    this.upsertPathTrackInTx(pathItem, now);

    const result = await readTrackMetadata(absolutePath, relativePath, {
      fsTimeoutMs: this.config.scanFsTimeoutMs,
    });
    const durationMs = await resolveReliableDurationMs(absolutePath, {
      ffprobePath: this.config.ffprobePath,
      fsTimeoutMs: this.config.scanFsTimeoutMs,
      relativePath,
    });
    const metadata = { ...result.metadata, durationMs };
    const itemWithMeta: ScanChunkItem = {
      ...pathItem,
      metadata,
      hasLrc,
    };
    this.upsertTagsTrackInTx(itemWithMeta, metadata, now);

    const row = this.db.raw
      .prepare(`SELECT ${TRACK_SELECT_COLUMNS} FROM tracks WHERE relative_path = ?`)
      .get(relativePath) as TrackRow | undefined;
    if (!row) {
      throw new BadRequestException('Failed to index downloaded file');
    }
    return this.tracksToDto([row])[0];
  }

  backfillDurationIfMissing(trackId: number): void {
    const track = this.getTrack(trackId);
    if (!track) {
      return;
    }
    if (track.duration_ms != null) {
      return;
    }
    if (this.durationBackfillInFlight.has(trackId)) {
      return;
    }
    const absolute = this.config.resolveUnderLibrary(track.relative_path);
    if (!absolute) {
      return;
    }

    this.durationBackfillInFlight.add(trackId);
    void resolveReliableDurationMs(absolute, {
      ffprobePath: this.config.ffprobePath,
      fsTimeoutMs: this.config.scanFsTimeoutMs,
      relativePath: track.relative_path,
    })
      .then((durationMs) => {
        const safeDuration = sanitizeDurationMs(durationMs);
        if (safeDuration == null) {
          return;
        }
        const fingerprint = makeFingerprint(
          track.artist,
          track.title,
          track.size_bytes,
          safeDuration,
        );
        const now = Date.now();
        this.db.raw
          .prepare(
            `UPDATE tracks SET duration_ms = ?, fingerprint = ?, updated_at = ? WHERE id = ?`,
          )
          .run(safeDuration, fingerprint, now, trackId);
        this.session.broadcast();
      })
      .catch((err) => {
        this.logger.warn(
          `Duration backfill failed for track ${trackId}: ${err instanceof Error ? err.message : err}`,
        );
      })
      .finally(() => {
        this.durationBackfillInFlight.delete(trackId);
      });
  }

  search(
    q: string,
    page: number,
    limit: number,
    minRating?: number,
    hideDuplicates = false,
    tagKeys: string[] = [],
    sort: LibrarySort = 'relevance',
  ): TrackPageDto {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;
    const query = q.trim();
    const rating = this.normalizeMinRating(minRating);
    const ratingSql = rating == null ? '' : ' AND rating >= ?';
    const ratingParams = rating == null ? [] : [rating];
    const availableSql = ' AND available = 1';
    const tagsFor = (idExpr: string) => this.tagFilterSql(idExpr, tagKeys);

    if (!query) {
      const tags = tagsFor('id');
      const baseWhere = `1=1${availableSql}${ratingSql}${tags.sql}`;
      const baseParams = [...ratingParams, ...tags.params];
      const orderBy = trackOrderSql(sort, {
        hasQuery: false,
        fts: false,
        qualified: false,
      });
      const { total, rows } = hideDuplicates
        ? this.searchDeduped(
            `SELECT ${TRACK_SELECT_COLUMNS} FROM tracks WHERE ${baseWhere}`,
            orderBy,
            baseParams,
            safeLimit,
            offset,
          )
        : this.searchPlain(
            `SELECT COUNT(*) AS n FROM tracks WHERE ${baseWhere}`,
            `SELECT ${TRACK_SELECT_COLUMNS} FROM tracks WHERE ${baseWhere}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
            baseParams,
            safeLimit,
            offset,
          );
      return {
        items: this.tracksToDto(rows),
        total,
        page: safePage,
        limit: safeLimit,
      };
    }

    const match = this.toFtsQuery(query);
    let total = 0;
    let rows: TrackRow[] = [];
    try {
      const tags = tagsFor('t.id');
      const ftsWhere = `tracks_fts MATCH ? AND t.available = 1${ratingSql}${tags.sql}`;
      const ftsOrder = trackOrderSql(sort, {
        hasQuery: true,
        fts: true,
        qualified: !hideDuplicates,
      });
      const ftsParams = [match, ...ratingParams, ...tags.params];
      if (hideDuplicates) {
        ({ total, rows } = this.searchDeduped(
          `SELECT ${TRACK_SELECT_COLUMNS.replace(/\b(\w+)/g, 't.$1')}, rank
           FROM tracks t
           JOIN tracks_fts f ON f.rowid = t.id
           WHERE ${ftsWhere}`,
          ftsOrder,
          ftsParams,
          safeLimit,
          offset,
        ));
      } else {
        ({ total, rows } = this.searchPlain(
          `SELECT COUNT(*) AS n FROM tracks t
           JOIN tracks_fts f ON f.rowid = t.id
           WHERE ${ftsWhere}`,
          `SELECT ${TRACK_SELECT_COLUMNS.replace(/\b(\w+)/g, 't.$1')} FROM tracks t
           JOIN tracks_fts f ON f.rowid = t.id
           WHERE ${ftsWhere}
           ORDER BY ${ftsOrder}
           LIMIT ? OFFSET ?`,
          ftsParams,
          safeLimit,
          offset,
        ));
      }
    } catch (err) {
      this.logger.warn(`FTS query failed, falling back to LIKE: ${err}`);
      const like = `%${query.replaceAll('%', '\\%')}%`;
      const tags = tagsFor('id');
      const likeWhere = `(title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\' OR album LIKE ? ESCAPE '\\') AND available = 1${ratingSql}${tags.sql}`;
      const likeOrder = trackOrderSql(sort, {
        hasQuery: true,
        fts: false,
        qualified: false,
      });
      const likeParams = [like, like, like, ...ratingParams, ...tags.params];
      if (hideDuplicates) {
        ({ total, rows } = this.searchDeduped(
          `SELECT ${TRACK_SELECT_COLUMNS} FROM tracks WHERE ${likeWhere}`,
          likeOrder,
          likeParams,
          safeLimit,
          offset,
        ));
      } else {
        ({ total, rows } = this.searchPlain(
          `SELECT COUNT(*) AS n FROM tracks WHERE ${likeWhere}`,
          `SELECT ${TRACK_SELECT_COLUMNS} FROM tracks WHERE ${likeWhere}
           ORDER BY ${likeOrder}
           LIMIT ? OFFSET ?`,
          likeParams,
          safeLimit,
          offset,
        ));
      }
    }

    return {
      items: this.tracksToDto(rows),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  orderedTrackIds(
    q: string,
    minRating?: number,
    hideDuplicates = false,
    tagKeys: string[] = [],
    sort: LibrarySort = 'relevance',
  ): number[] {
    const page = this.search(q, 1, 50_000, minRating, hideDuplicates, tagKeys, sort);
    return page.items.map((track) => track.id);
  }

  private tagFilterSql(
    idExpr: string,
    tagKeys: string[],
  ): { sql: string; params: string[] } {
    if (tagKeys.length === 0) {
      return { sql: '', params: [] };
    }
    const placeholders = tagKeys.map(() => '?').join(', ');
    return {
      sql: ` AND ${idExpr} IN (
        SELECT track_id FROM track_tag_names
        WHERE name_key IN (${placeholders})
        GROUP BY track_id
        HAVING COUNT(DISTINCT name_key) = ${tagKeys.length}
      )`,
      params: tagKeys,
    };
  }

  private searchPlain(
    countSql: string,
    rowsSql: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): { total: number; rows: TrackRow[] } {
    const total = (this.db.raw.prepare(countSql).get(...params) as { n: number }).n;
    const rows = this.db.raw
      .prepare(rowsSql)
      .all(...params, limit, offset) as TrackRow[];
    return { total, rows };
  }

  private searchDeduped(
    filteredSql: string,
    orderBy: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): { total: number; rows: TrackRow[] } {
    const countSql = `
      WITH filtered AS (${filteredSql}),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY ${DEDUPE_PARTITION}
          ORDER BY ${DEDUPE_KEEP_ORDER}
        ) AS rn
        FROM filtered
      )
      SELECT COUNT(*) AS n FROM ranked WHERE rn = 1
    `;
    const rowsSql = `
      WITH filtered AS (${filteredSql}),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (
          PARTITION BY ${DEDUPE_PARTITION}
          ORDER BY ${DEDUPE_KEEP_ORDER}
        ) AS rn
        FROM filtered
      )
      SELECT ${TRACK_SELECT_COLUMNS} FROM ranked WHERE rn = 1
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `;
    const total = (this.db.raw.prepare(countSql).get(...params) as { n: number }).n;
    const rows = this.db.raw
      .prepare(rowsSql)
      .all(...params, limit, offset) as TrackRow[];
    return { total, rows };
  }

  requireLibraryRootsForDownload(): string {
    const configured = this.config.configuredLibraryPaths;
    if (configured.length === 0) {
      throw new BadRequestException(LIBRARY_PATHS_SETTINGS_HINT);
    }
    const result = validateConfiguredLibraryPaths(
      configured,
      this.config.repoRoot,
    );
    if (result.validRoots.length === 0) {
      throw new BadRequestException(LIBRARY_PATHS_SETTINGS_HINT);
    }
    if (this.isRebasePending()) {
      throw new BadRequestException(LIBRARY_REBASE_REQUIRED_HINT);
    }
    return result.validRoots[0]!;
  }

  async startScan(body: LibraryScanBodyDto = {}): Promise<void> {
    const { validRoots } = this.prepareLibraryRootsForOperation({
      allowPartialInvalid: Boolean(body.acknowledgeInvalidRoots),
    });
    if (this.scanRunning) {
      return;
    }
    this.scanCancelRequested = false;
    this.scanRunning = true;
    void this.runScan(validRoots).finally(() => {
      this.scanRunning = false;
    });
  }

  async rebaseCatalogue(): Promise<LibraryRebaseResultDto> {
    if (this.config.configuredLibraryPaths.length === 0) {
      throw new BadRequestException(LIBRARY_PATHS_SETTINGS_HINT);
    }
    if (this.scanRunning) {
      throw new ConflictException('A library scan is already running.');
    }
    const roots = this.config.libraryPaths;
    if (roots.length === 0) {
      throw new BadRequestException(LIBRARY_PATHS_SETTINGS_HINT);
    }
    this.scanCancelRequested = false;
    this.scanRunning = true;
    try {
      await this.maybeRebaseCataloguePaths(roots);
      if (this.scanCancelRequested) {
        return {
          message: 'Rebase cancelled.',
          libraryStatus: this.status(),
        };
      }
      return {
        message: 'Catalogue paths rebased for the current library folders.',
        libraryStatus: this.status(),
      };
    } finally {
      this.scanRunning = false;
      if (this.jobStatus('scan').running) {
        this.setJob('scan', {
          running: false,
          message: null,
        });
      }
    }
  }

  private isRebasePending(): boolean {
    const stored = this.getStoredScanRoots();
    if (!stored) {
      return false;
    }
    return !sameRootSet(stored, this.config.libraryPaths);
  }

  private prepareLibraryRootsForOperation(options: {
    allowPartialInvalid: boolean;
  }): ReturnType<typeof validateConfiguredLibraryPaths> {
    const configured = this.config.configuredLibraryPaths;
    if (configured.length === 0) {
      throw new BadRequestException(LIBRARY_PATHS_SETTINGS_HINT);
    }
    const result = validateConfiguredLibraryPaths(
      configured,
      this.config.repoRoot,
    );
    if (result.validRoots.length === 0) {
      throw new BadRequestException(LIBRARY_PATHS_SETTINGS_HINT);
    }
    if (result.invalid.length > 0 && !options.allowPartialInvalid) {
      throw new ConflictException({
        message:
          'Some library folders are missing, not readable, or not folders.',
        invalidLibraryPaths: result.invalid,
      });
    }
    if (this.isRebasePending()) {
      throw new BadRequestException(LIBRARY_REBASE_REQUIRED_HINT);
    }
    return result;
  }

  cancelScan(): void {
    if (this.scanRunning) {
      this.scanCancelRequested = true;
      this.scanWorkerHost.cancel();
      return;
    }
    if (this.jobStatus('scan').running) {
      this.setJob('scan', {
        running: false,
        message: 'Scan cancelled',
      });
    }
  }

  /** Reconciles SQLite scan state with the in-process worker flag. */
  reconcileScanJob(reason: 'startup' | 'refresh'): boolean {
    if (!this.jobStatus('scan').running) {
      return false;
    }
    if (this.scanRunning) {
      return false;
    }
    if (reason === 'startup') {
      this.logger.warn(
        'Clearing orphaned library scan left marked running after a previous process exit',
      );
    }
    this.setJob('scan', {
      running: false,
      message:
        reason === 'startup'
          ? 'Scan interrupted (server restarted)'
          : 'Scan interrupted (no worker running)',
    });
    return true;
  }

  refreshScan(): LibraryStatusDto {
    this.reconcileScanJob('refresh');
    return this.status();
  }

  private async runScan(roots: string[]): Promise<void> {
    const layout: LibraryPathLayout = buildLibraryPathLayout(roots);
    const progressEstimate = this.getProgressEstimate();
    this.setJob('scan', {
      running: true,
      current: 0,
      total: progressEstimate,
      message: 'Preparing library scan…',
    });
    const walkErrors: ScanIssueDto[] = [];
    this.saveScanIssues([]);
    try {
      const existing = this.db.raw
        .prepare(`SELECT id, relative_path, size_bytes, mtime_ms FROM tracks`)
        .all() as Array<{
        id: number;
        relative_path: string;
        size_bytes: number;
        mtime_ms: number;
      }>;
      const existingByPath = new Map(
        existing.map((row) => [row.relative_path, row]),
      );
      const cataloguePaths = existing.map((row) => row.relative_path);

      const checkpoint = this.loadCheckpoint(roots);
      const startRootIndex = checkpoint?.rootIndex ?? 0;
      const seen = new Set<string>();
      for (let index = 0; index < startRootIndex; index += 1) {
        const root = roots[index]!;
        const key = layout.keys.get(root)!;
        for (const path of cataloguePaths) {
          if (cataloguePathBelongsToRoot(path, key, layout.multiRoot)) {
            seen.add(path);
          }
        }
      }

      let processed = seen.size;
      let sessionProcessed = 0;
      const startedAt = Date.now();
      let skippedDirs = 0;

      for (let rootIndex = startRootIndex; rootIndex < roots.length; rootIndex += 1) {
        const root = roots[rootIndex]!;
        const key = layout.keys.get(root)!;
        const rootCheckpoint =
          rootIndex === startRootIndex ? checkpoint : null;
        const completedGroups = rootCheckpoint?.completedGroups ?? [];
        const rootCataloguePaths = cataloguePaths.filter((path) =>
          cataloguePathBelongsToRoot(path, key, layout.multiRoot),
        );
        for (const path of seedSeenFromCompletedGroups(
          completedGroups,
          rootCataloguePaths.map((path) =>
            layout.multiRoot ? stripCataloguePath(key, path) ?? path : path,
          ),
        )) {
          seen.add(
            prefixCataloguePath(key, path, layout.multiRoot),
          );
        }
        processed = seen.size;

        const result = await this.scanSingleRoot({
          root,
          key,
          multiRoot: layout.multiRoot,
          roots,
          rootIndex,
          existing,
          existingByPath,
          completedGroups,
          seen,
          progressEstimate,
          sessionProcessed,
          startedAt,
          skippedDirs,
          walkErrors,
          onSessionProcessed: (count) => {
            sessionProcessed += count;
          },
          onSkippedDirs: (count) => {
            skippedDirs = count;
          },
          onProcessed: (count) => {
            processed = count;
          },
        });

        sessionProcessed = result.sessionProcessed;
        skippedDirs = result.skippedDirs;
        processed = result.processed;

        if (this.scanCancelRequested) {
          this.setJob('scan', {
            running: false,
            current: processed,
            total: processed,
            message: 'Scan cancelled',
          });
          return;
        }
      }

      this.saveScanIssues(walkErrors);

      const staleIds = existing
        .filter((row) => !seen.has(row.relative_path))
        .map((row) => row.id);
      if (staleIds.length > 0) {
        this.markTracksUnavailable(staleIds);
      }

      await this.runPhase2Metadata(walkErrors);

      if (this.scanCancelRequested) {
        this.setJob('scan', {
          running: false,
          current: processed,
          total: processed,
          message: 'Scan cancelled',
        });
        return;
      }

      this.setStoredScanRoots(roots);
      this.clearCheckpoint();
      this.setLastFullScanAt(Date.now());

      this.setJob('scan', {
        running: false,
        current: processed,
        total: processed,
        message: formatScanCompleteMessage(
          processed,
          skippedDirs + walkErrors.length,
        ),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Scan failed: ${message}`);
      this.saveScanIssues(walkErrors);
      this.setJob('scan', {
        running: false,
        message: `Scan failed: ${message}`,
      });
    } finally {
      await this.scanWorkerHost.terminate();
    }
  }

  private async scanSingleRoot(options: {
    root: string;
    key: string;
    multiRoot: boolean;
    roots: string[];
    rootIndex: number;
    existing: Array<{
      id: number;
      relative_path: string;
      size_bytes: number;
      mtime_ms: number;
    }>;
    existingByPath: Map<
      string,
      { id: number; relative_path: string; size_bytes: number; mtime_ms: number }
    >;
    completedGroups: string[];
    seen: Set<string>;
    progressEstimate: number;
    sessionProcessed: number;
    startedAt: number;
    skippedDirs: number;
    walkErrors: ScanIssueDto[];
    onSessionProcessed: (count: number) => void;
    onSkippedDirs: (count: number) => void;
    onProcessed: (count: number) => void;
  }): Promise<{
    sessionProcessed: number;
    skippedDirs: number;
    processed: number;
  }> {
    const {
      root,
      key,
      multiRoot,
      roots,
      rootIndex,
      existingByPath,
      completedGroups,
      seen,
      progressEstimate,
      walkErrors,
    } = options;
    let { sessionProcessed, skippedDirs } = options;
    let processed = seen.size;
    let currentFolder: {
      label: string;
      index: number;
      total: number;
      resuming?: boolean;
    } | null = null;

    const walkerExistingByPath = new Map<
      string,
      { size_bytes: number; mtime_ms: number }
    >();
    for (const [path, row] of existingByPath) {
      const stripped = multiRoot ? stripCataloguePath(key, path) : path;
      if (stripped == null) {
        continue;
      }
      walkerExistingByPath.set(stripped, {
        size_bytes: row.size_bytes,
        mtime_ms: row.mtime_ms,
      });
    }

    const walkerDirMtimes: Record<string, number> = {};
    for (const [path, mtimeMs] of Object.entries(this.getDirMtimes())) {
      const stripped = multiRoot ? stripCataloguePath(key, path) : path;
      if (stripped != null) {
        walkerDirMtimes[stripped] = mtimeMs;
      }
    }

    const prefixLabel = (label: string): string =>
      multiRoot ? `${key} / ${label}` : label;

    const currentRate = () =>
      estimateScanRate(sessionProcessed, Date.now() - options.startedAt);
    const updateScanProgress = () => {
      const skippedCount = skippedDirs + walkErrors.length;
      const filesPerSecond = currentRate();
      const message = formatPhase1ScanMessage(
        currentFolder,
        processed,
        skippedCount,
        filesPerSecond,
      );
      this.setJob('scan', {
        running: true,
        current: processed,
        total: progressEstimate,
        message,
      });
    };

    const payload = {
      root,
      chunkSize: this.config.scanChunkSize,
      metadataConcurrency: this.config.scanMetadataConcurrency,
      walkConcurrency: this.config.scanWalkConcurrency,
      fsTimeoutMs: this.config.scanFsTimeoutMs,
      skipLrcOnUnchanged: this.config.scanSkipLrcOnUnchanged,
      skipUnchangedDirs: this.config.scanSkipUnchangedDirs,
      completedGroups,
      existingByPath: Object.fromEntries(walkerExistingByPath.entries()),
      dirMtimes: walkerDirMtimes,
    };

    await this.scanWorkerHost.run({
      payload,
      shouldCancel: () => this.scanCancelRequested,
      onMessage: async (message) => {
        if (message.type === 'progress') {
          currentFolder = {
            label: prefixLabel(message.folder.label),
            index: message.folder.index,
            total: message.folder.total,
            resuming: message.folder.resuming,
          };
          updateScanProgress();
          return;
        }

        if (message.type === 'walkError') {
          const issue: ScanIssueDto = {
            path: displayScanPath(root, message.error.path),
            op: message.error.op,
            message: message.error.message,
          };
          walkErrors.push(issue);
          if (walkErrors.length <= 5) {
            this.logger.warn(
              `Scan skipped ${issue.op} on ${issue.path}: ${issue.message}`,
            );
          }
          updateScanProgress();
          return;
        }

        if (message.type === 'dirStat') {
          this.setDirMtime(
            prefixCataloguePath(key, message.relativePath, multiRoot),
            message.mtimeMs,
          );
          return;
        }

        if (message.type === 'dirSkipped') {
          skippedDirs += 1;
          for (const path of message.seenPaths) {
            const cataloguePath = prefixCataloguePath(key, path, multiRoot);
            seen.add(cataloguePath);
            this.markAvailable(cataloguePath);
          }
          processed = seen.size;
          const nextCompleted = [
            ...(this.loadCheckpoint(roots)?.completedGroups ?? completedGroups),
          ];
          if (!nextCompleted.includes(message.groupId)) {
            nextCompleted.push(message.groupId);
          }
          this.saveCheckpoint({
            roots,
            rootIndex,
            completedGroups: nextCompleted,
          });
          updateScanProgress();
          return;
        }

        if (message.type === 'chunk') {
          const prefixedItems = message.items.map((item) => ({
            ...item,
            relativePath: prefixCataloguePath(
              key,
              item.relativePath,
              multiRoot,
            ),
          }));

          for (const item of prefixedItems) {
            if (this.scanCancelRequested) {
              return;
            }
            seen.add(item.relativePath);
          }

          if (prefixedItems.length > 0) {
            this.processScanChunkBatch(prefixedItems);
            sessionProcessed += prefixedItems.length;
            processed = seen.size;
            options.onSessionProcessed(sessionProcessed);
            if (message.stats.parsed > 0) {
              this.logger.debug(
                `Scan chunk ${message.groupId}: ${message.stats.parsed} parsed, ${message.stats.unchanged} unchanged`,
              );
            }
          }

          if (message.folderComplete) {
            const nextCompleted = [
              ...(this.loadCheckpoint(roots)?.completedGroups ?? completedGroups),
            ];
            if (!nextCompleted.includes(message.groupId)) {
              nextCompleted.push(message.groupId);
            }
            this.saveCheckpoint({
              roots,
              rootIndex,
              completedGroups: nextCompleted,
            });
          }

          options.onProcessed(processed);
          updateScanProgress();
          await yieldEventLoop();
        }

        if (message.type === 'done') {
          processed = seen.size;
          skippedDirs = message.skippedDirs;
          options.onSkippedDirs(skippedDirs);
          options.onProcessed(processed);
        }
      },
    });

    return {
      sessionProcessed,
      skippedDirs,
      processed,
    };
  }

  private processScanChunkBatch(items: ScanChunkItem[]): void {
    const now = Date.now();
    const tx = this.db.raw.transaction((batch: ScanChunkItem[]) => {
      for (const item of batch) {
        if (item.unchanged) {
          this.markAvailableInTx(item.relativePath, now);
          if (item.hasLrc != null) {
            this.refreshLyricPresenceFromFlagInTx(
              item.relativePath,
              item.hasLrc,
              now,
            );
          }
          continue;
        }

        this.upsertPathTrackInTx(item, now);
        this.markAvailableInTx(item.relativePath, now);
        if (item.hasLrc != null) {
          this.refreshLyricPresenceFromFlagInTx(
            item.relativePath,
            item.hasLrc,
            now,
          );
        }
      }
    });
    tx(items);
  }

  private markAvailableInTx(relativePath: string, now: number): void {
    this.db.raw
      .prepare(
        `UPDATE tracks SET available = 1, updated_at = ? WHERE relative_path = ? AND available = 0`,
      )
      .run(now, relativePath);
  }

  private refreshLyricPresenceFromFlagInTx(
    relativePath: string,
    hasLrc: boolean,
    now: number,
  ): void {
    const row = this.db.raw
      .prepare(`SELECT id, lyric_status FROM tracks WHERE relative_path = ?`)
      .get(relativePath) as { id: number; lyric_status: string } | undefined;
    if (!row) {
      return;
    }
    if (hasLrc && row.lyric_status !== 'present') {
      this.db.raw
        .prepare(
          `UPDATE tracks SET lyric_status = 'present', lyric_source = COALESCE(lyric_source, 'local'), updated_at = ? WHERE id = ?`,
        )
        .run(now, row.id);
    } else if (!hasLrc && row.lyric_status === 'present') {
      this.db.raw
        .prepare(
          `UPDATE tracks SET lyric_status = 'missing', lyric_source = NULL, updated_at = ? WHERE id = ?`,
        )
        .run(now, row.id);
    }
  }

  private upsertPathTrackInTx(item: ScanChunkItem, now: number): void {
    upsertPathTrack(this.db.raw, item, now);
  }

  private upsertTagsTrackInTx(
    item: ScanChunkItem,
    parsed: NonNullable<ScanChunkItem['metadata']>,
    now: number,
  ): void {
    upsertTagsTrack(this.db.raw, item, parsed, now);
  }

  private async runPhase2Metadata(walkErrors: ScanIssueDto[]): Promise<void> {
    const pending = this.db.raw
      .prepare(
        `SELECT relative_path, format, size_bytes, mtime_ms
         FROM tracks
         WHERE metadata_status = 'pending' AND available = 1
         ORDER BY relative_path`,
      )
      .all() as Array<{
      relative_path: string;
      format: ScanChunkItem['format'];
      size_bytes: number;
      mtime_ms: number;
    }>;

    if (pending.length === 0) {
      return;
    }

    let completed = 0;
    const total = pending.length;
    const startedAt = Date.now();
    const batchSize = Math.max(50, Math.min(this.config.scanChunkSize, 500));
    const concurrency = this.config.scanMetadataConcurrency;
    const fsTimeoutMs = this.config.scanFsTimeoutMs;

    const updatePhase2Progress = () => {
      const rate = estimateScanRate(completed, Date.now() - startedAt);
      this.setJob('scan', {
        running: true,
        current: completed,
        total,
        message: formatPhase2ScanMessage(completed, total, rate),
      });
    };

    updatePhase2Progress();

    for (let offset = 0; offset < pending.length; offset += batchSize) {
      if (this.scanCancelRequested) {
        return;
      }

      const batch = pending.slice(offset, offset + batchSize);
      await mapWithConcurrency(batch, concurrency, async (row) => {
        if (this.scanCancelRequested) {
          return;
        }
        const absolute = this.config.resolveUnderLibrary(row.relative_path);
        if (!absolute) {
          return;
        }

        let hasLrc = false;
        try {
          await access(lyricPathFor(absolute), constants.F_OK);
          hasLrc = true;
        } catch {
          hasLrc = false;
        }

        try {
          const result = await readTrackMetadata(absolute, row.relative_path, {
            fsTimeoutMs,
          });
          const now = Date.now();
          const item: ScanChunkItem = {
            absolutePath: absolute,
            relativePath: row.relative_path,
            sizeBytes: row.size_bytes,
            mtimeMs: row.mtime_ms,
            format: row.format,
            unchanged: false,
            hasLrc,
            metadata: result.metadata,
          };
          this.upsertTagsTrackInTx(item, result.metadata, now);
        } catch (err) {
          walkErrors.push({
            path: row.relative_path,
            op: 'parse',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });

      completed += batch.length;
      updatePhase2Progress();
      this.session.broadcast();
      await yieldEventLoop();
    }
  }

  private markAvailable(relativePath: string): void {
    this.db.raw
      .prepare(
        `UPDATE tracks SET available = 1, updated_at = ? WHERE relative_path = ? AND available = 0`,
      )
      .run(Date.now(), relativePath);
  }

  private markTracksUnavailable(trackIds: number[]): void {
    const now = Date.now();
    const mark = this.db.raw.prepare(
      `UPDATE tracks SET available = 0, updated_at = ? WHERE id = ?`,
    );
    const deleteQueue = this.db.raw.prepare(
      `DELETE FROM queue_items WHERE track_id = ?`,
    );
    const tx = this.db.raw.transaction((ids: number[]) => {
      for (const id of ids) {
        mark.run(now, id);
        deleteQueue.run(id);
      }
    });
    tx(trackIds);

    const playback = this.db.raw
      .prepare(`SELECT current_queue_item_id, status FROM playback_state WHERE id = 1`)
      .get() as { current_queue_item_id: number | null; status: string };
    if (playback.current_queue_item_id) {
      const stillThere = this.db.raw
        .prepare(`SELECT id FROM queue_items WHERE id = ?`)
        .get(playback.current_queue_item_id);
      if (!stillThere) {
        const first = this.db.raw
          .prepare(
            `SELECT id FROM queue_items ORDER BY position ASC, id ASC LIMIT 1`,
          )
          .get() as { id: number } | undefined;
        this.db.raw
          .prepare(
            `UPDATE playback_state SET current_queue_item_id = ?, status = ?, position_ms = 0, seek_seq = seek_seq + 1, updated_at = ? WHERE id = 1`,
          )
          .run(first?.id ?? null, first ? 'paused' : 'idle', now);
      }
    }
    this.session.broadcast();
  }

  private getSetting(key: string): string | null {
    const row = this.db.raw
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setSetting(key: string, value: string): void {
    this.db.raw
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  private getStoredScanRoots(): string[] | null {
    return parseStoredScanRoots(this.getSetting(LIBRARY_SCAN_ROOT_KEY));
  }

  private setStoredScanRoots(roots: string[]): void {
    this.setSetting(LIBRARY_SCAN_ROOT_KEY, serializeStoredScanRoots(roots));
  }

  private loadCheckpoint(roots: string[]): ScanCheckpoint | null {
    const checkpoint = parseScanCheckpoint(
      this.getSetting(LIBRARY_SCAN_CHECKPOINT_KEY),
    );
    if (!checkpoint || !checkpointMatchesRoots(checkpoint, roots)) {
      return null;
    }
    return checkpoint;
  }

  private saveCheckpoint(checkpoint: ScanCheckpoint): void {
    this.setSetting(LIBRARY_SCAN_CHECKPOINT_KEY, JSON.stringify(checkpoint));
  }

  private clearCheckpoint(): void {
    this.db.raw
      .prepare(`DELETE FROM app_settings WHERE key = ?`)
      .run(LIBRARY_SCAN_CHECKPOINT_KEY);
  }

  private getLastFullScanAt(): number | null {
    const raw = this.getSetting(LIBRARY_LAST_FULL_SCAN_AT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private setLastFullScanAt(timestamp: number): void {
    this.setSetting(LIBRARY_LAST_FULL_SCAN_AT_KEY, String(timestamp));
  }

  private getScanIssues(): ScanIssueDto[] {
    return parseScanIssues(this.getSetting(LIBRARY_SCAN_ISSUES_KEY));
  }

  private saveScanIssues(issues: ScanIssueDto[]): void {
    this.setSetting(
      LIBRARY_SCAN_ISSUES_KEY,
      JSON.stringify(issues.slice(0, MAX_SCAN_ISSUES)),
    );
  }

  private getProgressEstimate(): number {
    const lastJob = this.jobStatus('scan');
    if (lastJob.total > 0) {
      return lastJob.total;
    }
    const trackCount = this.db.raw
      .prepare(`SELECT COUNT(*) AS n FROM tracks WHERE available = 1`)
      .get() as { n: number };
    return trackCount.n;
  }

  private getDirMtimes(): Record<string, number> {
    const rows = this.db.raw
      .prepare(`SELECT relative_path, mtime_ms FROM library_dir_stats`)
      .all() as Array<{ relative_path: string; mtime_ms: number }>;
    return Object.fromEntries(rows.map((row) => [row.relative_path, row.mtime_ms]));
  }

  private setDirMtime(relativePath: string, mtimeMs: number): void {
    this.db.raw
      .prepare(
        `INSERT INTO library_dir_stats (relative_path, mtime_ms) VALUES (?, ?)
         ON CONFLICT(relative_path) DO UPDATE SET mtime_ms = excluded.mtime_ms`,
      )
      .run(relativePath, mtimeMs);
  }

  private async maybeRebaseCataloguePaths(newRoots: string[]): Promise<void> {
    const storedRoots = this.getStoredScanRoots();
    const rows = this.db.raw
      .prepare(`SELECT id, relative_path FROM tracks`)
      .all() as Array<{ id: number; relative_path: string }>;

    const plan = planMultiRootRebase(storedRoots, newRoots, rows);
    if (!plan) {
      return;
    }

    if (plan.warnMessage) {
      if (plan.clearCheckpoint) {
        this.clearCheckpoint();
      }
      this.logger.warn(plan.warnMessage);
    }

    if (plan.pathUpdates.length === 0) {
      if (plan.logMessage) {
        this.logger.log(plan.logMessage);
      }
      this.setStoredScanRoots(plan.storedRootsAfter);
      return;
    }

    const update = this.db.raw.prepare(
      `UPDATE tracks SET relative_path = ?, updated_at = ? WHERE id = ?`,
    );
    const now = Date.now();
    let applied = 0;
    const total = plan.pathUpdates.length;

    this.setJob('scan', {
      running: true,
      current: 0,
      total,
      message: `Rebasing paths 0 / ${total.toLocaleString()}`,
    });

    for (
      let offset = 0;
      offset < plan.pathUpdates.length;
      offset += this.config.scanChunkSize
    ) {
      if (this.scanCancelRequested) {
        this.setJob('scan', {
          running: false,
          current: applied,
          total,
          message: 'Scan cancelled',
        });
        return;
      }

      const batch = plan.pathUpdates.slice(
        offset,
        offset + this.config.scanChunkSize,
      );
      const tx = this.db.raw.transaction((updates: typeof batch) => {
        for (const row of updates) {
          update.run(row.relative_path, now, row.id);
        }
      });
      tx(batch);
      applied += batch.length;

      this.setJob('scan', {
        running: true,
        current: applied,
        total,
        message: `Rebasing paths ${applied.toLocaleString()} / ${total.toLocaleString()}`,
      });
      await yieldEventLoop();
    }

    this.setStoredScanRoots(plan.storedRootsAfter);
    if (plan.logMessage) {
      this.logger.log(
        `${plan.logMessage} (${plan.pathUpdates.length} path update(s))`,
      );
    } else {
      this.logger.log(
        `Rebased ${plan.pathUpdates.length} catalogue path(s) for library path change`,
      );
    }
  }

  private normalizeMinRating(minRating?: number): number | null {
    if (minRating == null || !Number.isFinite(minRating)) {
      return null;
    }
    const n = Math.floor(minRating);
    if (n < 1 || n > 10) {
      return null;
    }
    return n;
  }

  private toFtsQuery(raw: string): string {
    const tokens = raw
      .replace(/["*']/g, ' ')
      .split(/[^\p{L}\p{N}]+/u)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 12);
    if (tokens.length === 0) {
      return '""';
    }
    return tokens.map((t) => `"${t}"*`).join(' AND ');
  }
}
