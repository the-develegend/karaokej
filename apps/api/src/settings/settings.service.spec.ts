import { defaultMetadataProvidersSettings } from '@karaokej/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SETTING_CROSSFADE_SECONDS,
  SETTING_CROSSFADE_SECONDS_PREF,
  SETTING_RATING_BLUE,
  SETTING_RATING_GOLD,
  SETTING_RATING_RASPBERRY,
  SETTING_RATING_SILVER,
  SettingsService,
} from './settings.service';
import { createTestDb, TestDbService } from '../test/test-db';

describe('SettingsService', () => {
  let db: TestDbService;
  let cleanup: () => void;
  let settings: SettingsService;
  let clearToolPathOverrideCache: ReturnType<typeof vi.fn>;
  let clearLibraryLayoutCache: ReturnType<typeof vi.fn>;
  let clearLibraryPathsCache: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    clearToolPathOverrideCache = vi.fn();
    clearLibraryLayoutCache = vi.fn();
    clearLibraryPathsCache = vi.fn();
    settings = new SettingsService(db as never, {
      clearToolPathOverrideCache,
      clearLibraryLayoutCache,
      clearLibraryPathsCache,
    } as never);
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults crossfade to off with a 5 second preference', () => {
    expect(settings.get()).toEqual({
      metadataProviders: defaultMetadataProvidersSettings(),
      removePlayedFromQueue: false,
      crossfadeSeconds: 0,
      crossfadePrefSeconds: 5,
      ratingGold: '#ffe08a',
      ratingSilver: '#c8d0dc',
      ratingBlue: '#3b82f6',
      ratingRaspberry: '#e11d74',
      ytdlpPath: '',
      ffmpegPath: '',
      ffprobePath: '',
      ytdlpNodePath: '',
      ytsaverPath: '',
      demucsPath: '',
      libraryPaths: [],
      mainLibraryPath: null,
    });
  });

  it('persists library paths and clears layout cache', () => {
    settings.patch({ libraryPaths: ['./music', '/abs/lib'] });
    expect(settings.get().libraryPaths).toEqual(['./music', '/abs/lib']);
    expect(settings.get().mainLibraryPath).toBe('./music');
    expect(clearLibraryLayoutCache).toHaveBeenCalled();
    expect(clearLibraryPathsCache).toHaveBeenCalled();
    settings.patch({ libraryPaths: [] });
    expect(settings.get().libraryPaths).toEqual([]);
  });

  it('persists tool path overrides and clears config cache', () => {
    settings.patch({ ytdlpPath: '/custom/yt-dlp.exe' });
    expect(settings.get().ytdlpPath).toBe('/custom/yt-dlp.exe');
    expect(clearToolPathOverrideCache).toHaveBeenCalled();
    settings.patch({ ytdlpPath: '  ' });
    expect(settings.get().ytdlpPath).toBe('');
  });

  it('clamps crossfade seconds to 0 through 10', () => {
    expect(settings.patch({ crossfadeSeconds: 12 }).crossfadeSeconds).toBe(10);
    expect(settings.patch({ crossfadeSeconds: -3 }).crossfadeSeconds).toBe(0);
  });

  it('updates the preference when enabling a non-zero crossfade duration', () => {
    settings.patch({ crossfadeSeconds: 7 });
    expect(settings.get()).toMatchObject({
      crossfadeSeconds: 7,
      crossfadePrefSeconds: 7,
    });
  });

  it('keeps the preference when turning crossfade off', () => {
    settings.patch({ crossfadeSeconds: 8 });
    settings.patch({ crossfadeSeconds: 0 });
    expect(settings.get()).toMatchObject({
      crossfadeSeconds: 0,
      crossfadePrefSeconds: 8,
    });
  });

  it('persists crossfade values in app_settings', () => {
    settings.patch({ crossfadeSeconds: 4 });
    const live = db.raw
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(SETTING_CROSSFADE_SECONDS) as { value: string };
    const pref = db.raw
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(SETTING_CROSSFADE_SECONDS_PREF) as { value: string };
    expect(live.value).toBe('4');
    expect(pref.value).toBe('4');
  });

  it('persists rating colors in app_settings', () => {
    settings.patch({
      ratingGold: '#aabbcc',
      ratingSilver: '#ddeeff',
      ratingBlue: '#112233',
      ratingRaspberry: '#445566',
    });
    expect(settings.get()).toMatchObject({
      ratingGold: '#aabbcc',
      ratingSilver: '#ddeeff',
      ratingBlue: '#112233',
      ratingRaspberry: '#445566',
    });
    const gold = db.raw
      .prepare(`SELECT value FROM app_settings WHERE key = ?`)
      .get(SETTING_RATING_GOLD) as { value: string };
    expect(gold.value).toBe('#aabbcc');
  });

  it('falls back to defaults for invalid rating colors', () => {
    db.raw
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTING_RATING_GOLD, 'not-a-color');
    db.raw
      .prepare(
        `INSERT INTO app_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(SETTING_RATING_SILVER, '#12345');
    expect(settings.get()).toMatchObject({
      ratingGold: '#ffe08a',
      ratingSilver: '#c8d0dc',
    });
    expect(
      settings.patch({ ratingBlue: 'blue' }).ratingBlue,
    ).toBe('#3b82f6');
  });
});
