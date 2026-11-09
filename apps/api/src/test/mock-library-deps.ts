import { buildLibraryPathLayout } from '../library/library-paths';

/** Minimal SettingsService stub for LibraryService constructors in unit tests. */
export function createMockLibrarySettings(
  configuredPaths: string[] = [],
  mainPath: string | null = configuredPaths[0] ?? null,
) {
  return {
    getLibraryPaths: () => configuredPaths,
    getEffectiveMainLibraryPath: () =>
      mainPath && configuredPaths.includes(mainPath)
        ? mainPath
        : (configuredPaths[0] ?? null),
  };
}

/** Minimal AppConfigService fields LibraryService.tracksToDto needs. */
export function createMockLibraryConfig(
  overrides: Record<string, unknown> = {},
) {
  return {
    libraryPaths: [],
    libraryLayout: buildLibraryPathLayout([]),
    ...overrides,
  };
}
