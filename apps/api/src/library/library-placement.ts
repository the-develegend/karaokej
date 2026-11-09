import { extname } from 'node:path';
import { LibraryPlacement } from '@karaokej/shared';
import { buildLibraryRelativePath } from './library-path-layout';
import {
  stripCataloguePath,
  type LibraryPathLayout,
} from './library-paths';

export interface LibraryPlacementInput {
  cataloguePath: string;
  title: string;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  year: number | null;
  trackNo: number | null;
  format: string;
  layout: LibraryPathLayout;
  /** Absolute resolved main library root, or null when none configured. */
  mainRoot: string | null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fileExtension(cataloguePath: string, format: string): string {
  const base = cataloguePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const fromPath = extname(base).toLowerCase();
  if (fromPath) {
    return fromPath;
  }
  const trimmed = format.trim().toLowerCase();
  return trimmed ? `.${trimmed.replace(/^\./, '')}` : '';
}

/** True when actual equals canonical, or canonical with a move conflict suffix `(N)`. */
export function matchesCanonicalLayoutPath(
  actual: string,
  canonical: string,
): boolean {
  const normalizedActual = actual.replace(/\\/g, '/');
  const normalizedCanonical = canonical.replace(/\\/g, '/');
  if (normalizedActual === normalizedCanonical) {
    return true;
  }

  const slash = normalizedCanonical.lastIndexOf('/');
  const dir = slash >= 0 ? normalizedCanonical.slice(0, slash) : '';
  const file =
    slash >= 0 ? normalizedCanonical.slice(slash + 1) : normalizedCanonical;
  const dot = file.lastIndexOf('.');
  if (dot <= 0) {
    return false;
  }
  const stem = file.slice(0, dot);
  const ext = file.slice(dot);

  const actualSlash = normalizedActual.lastIndexOf('/');
  const actualDir =
    actualSlash >= 0 ? normalizedActual.slice(0, actualSlash) : '';
  const actualFile =
    actualSlash >= 0
      ? normalizedActual.slice(actualSlash + 1)
      : normalizedActual;
  if (actualDir !== dir) {
    return false;
  }

  const match = actualFile.match(
    new RegExp(`^${escapeRegExp(stem)} \\((\\d+)\\)${escapeRegExp(ext)}$`),
  );
  if (!match) {
    return false;
  }
  return Number(match[1]) >= 2;
}

export function relativePathUnderMain(
  cataloguePath: string,
  layout: LibraryPathLayout,
  mainRoot: string,
): string | null {
  const normalized = cataloguePath.replace(/\\/g, '/');
  if (!layout.multiRoot) {
    return normalized;
  }
  const key = layout.keys.get(mainRoot);
  if (!key) {
    return null;
  }
  return stripCataloguePath(key, normalized);
}

/**
 * Classify a track relative to the main library root and canonical layout.
 * Non-main roots never count as organized, even when tidy there.
 */
export function classifyLibraryPlacement(
  input: LibraryPlacementInput,
): LibraryPlacement {
  if (!input.mainRoot) {
    return 'outside_main';
  }

  const underMain = relativePathUnderMain(
    input.cataloguePath,
    input.layout,
    input.mainRoot,
  );
  if (underMain == null) {
    return 'outside_main';
  }

  const expected = buildLibraryRelativePath({
    title: input.title,
    artist: input.artist,
    albumArtist: input.albumArtist,
    album: input.album,
    year: input.year,
    trackNo: input.trackNo,
    fileExtension: fileExtension(input.cataloguePath, input.format),
  });
  if (!expected) {
    return 'in_main_unsorted';
  }
  if (matchesCanonicalLayoutPath(underMain, expected)) {
    return 'organized';
  }
  return 'in_main_unsorted';
}

/** Map settings main path string → absolute root from layout.roots. */
export function resolveMainRootAbsolute(
  configuredPaths: string[],
  effectiveMainPath: string | null,
  layout: LibraryPathLayout,
): string | null {
  if (layout.roots.length === 0) {
    return null;
  }
  const main =
    effectiveMainPath && configuredPaths.includes(effectiveMainPath)
      ? effectiveMainPath
      : (configuredPaths[0] ?? null);
  if (!main) {
    return null;
  }
  const index = configuredPaths.indexOf(main);
  if (index < 0) {
    return null;
  }
  return layout.roots[index] ?? null;
}
