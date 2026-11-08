import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  SETTING_TOOL_PATH_DEMUCS,
  SETTING_TOOL_PATH_FFMPEG,
  SETTING_TOOL_PATH_FFPROBE,
  SETTING_TOOL_PATH_YTDLP,
  SETTING_TOOL_PATH_YTDLP_NODE,
  SETTING_TOOL_PATH_YTSAVER,
  TOOL_PATH_SETTING_KEYS,
} from '../settings/tool-path-keys';
import { SETTING_LIBRARY_PATHS } from '../settings/library-path-keys';
import {
  buildLibraryPathLayout,
  parseLibraryPathsSetting,
  resolveConfiguredLibraryPaths,
  resolveUnderLibraries,
  type LibraryPathLayout,
} from '../library/library-paths';
import { resolveFfmpegForYtdlp, isYtSaverPath } from '../external/ytdlp-path-utils';
import { findCommandOnPath } from './path-lookup';
import { readPortableConfig } from './portable-config';

function clampInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function envFlag(value: string | undefined): boolean {
  return value === '1' || value?.toLowerCase() === 'true';
}

@Injectable()
export class AppConfigService {
  private libraryLayoutCache: LibraryPathLayout | null = null;
  private libraryPathsSettingCache: string[] | null = null;
  private toolPathOverrideCache: Map<string, string> | null = null;

  constructor(private readonly config: ConfigService) {}

  clearToolPathOverrideCache(): void {
    this.toolPathOverrideCache = null;
  }

  /** Repo root, or install folder when KARAOKEJ_ROOT is set (Electron). */
  get repoRoot(): string {
    const portableRoot = process.env.KARAOKEJ_ROOT?.trim();
    if (portableRoot) {
      return resolve(portableRoot);
    }
    return resolve(__dirname, '../../../../');
  }

  clearLibraryLayoutCache(): void {
    this.libraryLayoutCache = null;
  }

  clearLibraryPathsCache(): void {
    this.libraryPathsSettingCache = null;
  }

  /** Paths as saved in settings (not resolved to absolute). */
  get configuredLibraryPaths(): string[] {
    return this.readLibraryPathsSetting();
  }

  get libraryPaths(): string[] {
    return this.libraryLayout.roots;
  }

  get libraryPath(): string | null {
    return this.libraryPaths[0] ?? null;
  }

  get libraryLayout(): LibraryPathLayout {
    if (!this.libraryLayoutCache) {
      const configured = this.readLibraryPathsSetting();
      const roots = resolveConfiguredLibraryPaths(configured, this.repoRoot);
      this.libraryLayoutCache = buildLibraryPathLayout(roots);
    }
    return this.libraryLayoutCache;
  }

  /** One-time migration: read legacy env / portable entries (not used after seed). */
  legacyLibraryPathSeedEntries(): string[] {
    let musicPath = this.config.get<string>('MUSIC_LIBRARY_PATH');
    if (!musicPath?.trim() && process.env.KARAOKEJ_ROOT?.trim()) {
      const portable = readPortableConfig(process.env.KARAOKEJ_ROOT);
      if (portable?.libraryPaths.length) {
        return portable.libraryPaths.map((p) => p.trim()).filter(Boolean);
      }
    }
    if (!musicPath?.trim()) {
      return [];
    }
    return musicPath
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  private readLibraryPathsSetting(): string[] {
    if (this.libraryPathsSettingCache) {
      return this.libraryPathsSettingCache;
    }
    const paths: string[] = [];
    try {
      const dbPath = this.databasePath;
      if (!existsSync(dbPath)) {
        this.libraryPathsSettingCache = paths;
        return paths;
      }
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const row = db
        .prepare(`SELECT value FROM app_settings WHERE key = ?`)
        .get(SETTING_LIBRARY_PATHS) as { value: string } | undefined;
      db.close();
      if (row?.value) {
        paths.push(...parseLibraryPathsSetting(row.value));
      }
    } catch {
      /* use empty */
    }
    this.libraryPathsSettingCache = paths;
    return paths;
  }

  get databasePath(): string {
    const raw =
      this.config.get<string>('DATABASE_PATH') ?? './data/karaokej.sqlite';
    const resolved = isAbsolute(raw) ? raw : resolve(this.repoRoot, raw);
    mkdirSync(dirname(resolved), { recursive: true });
    return resolved;
  }

  get lrclibBaseUrl(): string {
    return (
      this.config.get<string>('LRCLIB_BASE_URL')?.replace(/\/$/, '') ??
      'https://lrclib.net'
    );
  }

  get audiodbBaseUrl(): string {
    return (
      this.config.get<string>('AUDIODB_BASE_URL')?.replace(/\/$/, '') ??
      'https://www.theaudiodb.com/api/v1/json'
    );
  }

  get audiodbApiKey(): string {
    return this.config.get<string>('AUDIODB_API_KEY')?.trim() || '123';
  }

  get deezerBaseUrl(): string {
    return (
      this.config.get<string>('DEEZER_BASE_URL')?.replace(/\/$/, '') ??
      'https://api.deezer.com'
    );
  }

  get ytsaverPath(): string {
    return this.resolveToolPath(SETTING_TOOL_PATH_YTSAVER, () => this.envYtsaverPath());
  }

  get ytdlpPath(): string {
    return this.resolveToolPath(SETTING_TOOL_PATH_YTDLP, () => this.envYtdlpPath());
  }

  get ffmpegPath(): string {
    return this.resolveToolPath(SETTING_TOOL_PATH_FFMPEG, () => this.envFfmpegPath());
  }

  private envYtsaverPath(): string {
    const raw =
      this.config.get<string>('YTSAVER_PATH') ??
      '/mnt/c/Program Files/YT Saver/ytsaverw.exe';
    return isAbsolute(raw) ? raw : resolve(this.repoRoot, raw);
  }

  private envYtdlpPath(): string {
    const raw =
      this.config.get<string>('YTDLP_PATH') ??
      '/mnt/c/Program Files/yt-dlp/yt-dlp.exe';
    return isAbsolute(raw) ? raw : resolve(this.repoRoot, raw);
  }

  private envFfmpegPath(): string {
    const raw = this.config.get<string>('FFMPEG_PATH')?.trim();
    if (raw && !isYtSaverPath(raw)) {
      return isAbsolute(raw) ? raw : resolve(this.repoRoot, raw);
    }
    if (existsSync('/usr/bin/ffmpeg')) {
      return '/usr/bin/ffmpeg';
    }
    const bundled = this.bundledWindowsFfmpegPath();
    if (existsSync(bundled)) {
      return bundled;
    }
    return 'ffmpeg';
  }

  /**
   * ffmpeg for yt-dlp post-processing. A Windows yt-dlp.exe cannot run
   * /usr/bin/ffmpeg, so use the vendored Windows build instead.
   */
  get ytdlpFfmpegPath(): string {
    const bundled = this.bundledWindowsFfmpegPath();
    return resolveFfmpegForYtdlp(
      this.ytdlpPath,
      this.ffmpegPath,
      existsSync(bundled) ? bundled : null,
    );
  }

  private bundledWindowsFfmpegPath(): string {
    return resolve(this.repoRoot, 'vendor/win/bin/ffmpeg.exe');
  }

  get ffprobePath(): string {
    return this.resolveToolPath(SETTING_TOOL_PATH_FFPROBE, () => this.envFfprobePath());
  }

  private envFfprobePath(): string {
    const raw = this.config.get<string>('FFPROBE_PATH')?.trim();
    if (raw) {
      return isAbsolute(raw) ? raw : resolve(this.repoRoot, raw);
    }
    if (existsSync('/usr/bin/ffprobe')) {
      return '/usr/bin/ffprobe';
    }
    const ffmpeg = this.ffmpegPath;
    const sibling = ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
    if (existsSync(sibling)) {
      return sibling;
    }
    return 'ffprobe';
  }

  get demucsPath(): string {
    const override = this.getToolPathOverride(SETTING_TOOL_PATH_DEMUCS);
    if (override) {
      return isAbsolute(override) ? override : resolve(this.repoRoot, override);
    }
    return this.config.get<string>('DEMUCS_PATH')?.trim() || 'demucs';
  }

  get demucsPythonModule(): string | null {
    return this.config.get<string>('DEMUCS_PYTHON_MODULE')?.trim() || null;
  }

  get demucsModel(): string {
    return this.config.get<string>('DEMUCS_MODEL')?.trim() || 'htdemucs';
  }

  get demucsExtraArgs(): string[] {
    const raw = this.config.get<string>('DEMUCS_EXTRA_ARGS')?.trim();
    if (!raw) {
      return [];
    }
    return raw.split(/\s+/).filter(Boolean);
  }

  get demucsTimeoutMs(): number {
    return clampInt(
      this.config.get<string>('DEMUCS_TIMEOUT_MS'),
      1_800_000,
      60_000,
      7_200_000,
    );
  }

  get stemCachePath(): string {
    const raw =
      this.config.get<string>('DEMUCS_STEM_CACHE_PATH') ??
      './data/karaoke-stems';
    const resolved = isAbsolute(raw) ? raw : resolve(this.repoRoot, raw);
    mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  get coverCachePath(): string {
    const raw = this.config.get<string>('COVER_CACHE_PATH') ?? './data/covers';
    const resolved = isAbsolute(raw) ? raw : resolve(this.repoRoot, raw);
    mkdirSync(resolved, { recursive: true });
    return resolved;
  }

  get coverConcurrency(): number {
    return clampInt(this.config.get<string>('COVER_CONCURRENCY'), 4, 1, 8);
  }

  get coverTimeoutMs(): number {
    return clampInt(
      this.config.get<string>('COVER_TIMEOUT_MS'),
      20_000,
      2_000,
      120_000,
    );
  }

  isDemucsAvailable(): boolean {
    return this.resolveDemucsExecutable() !== null;
  }

  resolveDemucsExecutable(): string | null {
    const configured = this.demucsPath;
    if (configured.includes('/') || configured.includes('\\')) {
      return existsSync(configured) ? configured : null;
    }
    return findCommandOnPath(configured);
  }

  resolveDemucsSpawn(): { executable: string; prefixArgs: string[] } | null {
    const executable = this.resolveDemucsExecutable();
    if (!executable) {
      return null;
    }
    const module = this.demucsPythonModule;
    if (module) {
      return { executable, prefixArgs: ['-m', module] };
    }
    return { executable, prefixArgs: [] };
  }

  get ytdlpAudioFormat(): string {
    return this.config.get<string>('YTDLP_AUDIO_FORMAT')?.trim() || 'mp3';
  }

  /**
   * Node binary for yt-dlp YouTube JS challenges.
   * Windows yt-dlp.exe cannot run the WSL Node from nvm; prefer a Windows node.exe.
   */
  get ytdlpNodePath(): string {
    return this.resolveToolPath(SETTING_TOOL_PATH_YTDLP_NODE, () => this.envYtdlpNodePath());
  }

  private envYtdlpNodePath(): string {
    const raw = this.config.get<string>('YTDLP_NODE_PATH')?.trim();
    if (raw) {
      return isAbsolute(raw) ? raw : resolve(this.repoRoot, raw);
    }
    if (this.ytdlpPath.toLowerCase().endsWith('.exe')) {
      const windowsNode = '/mnt/c/Program Files/nodejs/node.exe';
      if (existsSync(windowsNode)) {
        return windowsNode;
      }
    }
    return process.execPath;
  }

  private resolveToolPath(
    settingKey: string,
    envFallback: () => string,
  ): string {
    const override = this.getToolPathOverride(settingKey);
    if (override) {
      return isAbsolute(override) ? override : resolve(this.repoRoot, override);
    }
    return envFallback();
  }

  private getToolPathOverride(settingKey: string): string | null {
    const value = this.readToolPathOverrides().get(settingKey)?.trim();
    return value ? value : null;
  }

  private readToolPathOverrides(): Map<string, string> {
    if (this.toolPathOverrideCache) {
      return this.toolPathOverrideCache;
    }
    const map = new Map<string, string>();
    try {
      const dbPath = this.databasePath;
      if (!existsSync(dbPath)) {
        this.toolPathOverrideCache = map;
        return map;
      }
      const db = new DatabaseSync(dbPath, { readOnly: true });
      const placeholders = TOOL_PATH_SETTING_KEYS.map(() => '?').join(', ');
      const rows = db
        .prepare(
          `SELECT key, value FROM app_settings WHERE key IN (${placeholders})`,
        )
        .all(...TOOL_PATH_SETTING_KEYS) as Array<{ key: string; value: string }>;
      db.close();
      for (const row of rows) {
        map.set(row.key, row.value);
      }
    } catch {
      /* use env defaults */
    }
    this.toolPathOverrideCache = map;
    return map;
  }

  get scanChunkSize(): number {
    return clampInt(
      this.config.get<string>('LIBRARY_SCAN_CHUNK_SIZE'),
      1000,
      50,
      5000,
    );
  }

  get scanMetadataConcurrency(): number {
    return clampInt(
      this.config.get<string>('LIBRARY_SCAN_METADATA_CONCURRENCY'),
      8,
      1,
      8,
    );
  }

  get scanWalkConcurrency(): number {
    return clampInt(
      this.config.get<string>('LIBRARY_SCAN_WALK_CONCURRENCY'),
      this.scanMetadataConcurrency,
      1,
      8,
    );
  }

  get scanFsTimeoutMs(): number {
    return clampInt(
      this.config.get<string>('LIBRARY_SCAN_FS_TIMEOUT_MS'),
      15000,
      1000,
      120000,
    );
  }

  get scanSkipUnchangedDirs(): boolean {
    return envFlag(this.config.get<string>('LIBRARY_SCAN_SKIP_UNCHANGED_DIRS'));
  }

  get scanSkipLrcOnUnchanged(): boolean {
    return envFlag(this.config.get<string>('LIBRARY_SCAN_SKIP_LRC_ON_UNCHANGED'));
  }

  resolveUnderLibrary(
    relativePath: string,
    legacyUnprefixedRoot?: string | null,
  ): string | null {
    return resolveUnderLibraries(
      relativePath,
      this.libraryLayout,
      legacyUnprefixedRoot ?? this.libraryPath,
    );
  }
}
