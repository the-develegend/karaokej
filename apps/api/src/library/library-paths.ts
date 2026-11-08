import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { nestingRelative, relativeInsideNormalized } from './scan-root';

export interface LibraryPathLayout {
  roots: string[];
  keys: Map<string, string>;
  multiRoot: boolean;
}

function normalizeRoot(path: string): string {
  return resolve(path);
}

function resolvePathEntries(
  entries: string[],
  repoRoot: string,
): string[] {
  const resolved = entries.map((entry) =>
    isAbsolute(entry) ? resolve(entry) : resolve(repoRoot, entry),
  );

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const path of resolved) {
    const normalized = normalizeRoot(path);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(normalized);
    }
  }
  return collapseNestedRoots(unique);
}

/** Split comma-separated env value into resolved, deduped, non-nested roots. */
export function parseLibraryPathEntries(
  raw: string | undefined,
  repoRoot: string,
): string[] {
  if (!raw?.trim()) {
    return [];
  }
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return resolvePathEntries(entries, repoRoot);
}

/** Resolve configured path strings from settings into catalogue roots. */
export function resolveConfiguredLibraryPaths(
  entries: string[],
  repoRoot: string,
): string[] {
  const trimmed = entries.map((entry) => entry.trim()).filter(Boolean);
  if (trimmed.length === 0) {
    return [];
  }
  return resolvePathEntries(trimmed, repoRoot);
}

export function parseLibraryPathsSetting(
  raw: string | null | undefined,
): string[] {
  if (!raw?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === 'string')
    ) {
      return parsed.map((entry) => entry.trim()).filter(Boolean);
    }
  } catch {
    /* fall through */
  }
  return [];
}

export function serializeLibraryPathsSetting(paths: string[]): string {
  const cleaned = paths.map((p) => p.trim()).filter(Boolean);
  return JSON.stringify(cleaned);
}

/** Drop roots nested under another configured root (parent walk covers them). */
export function collapseNestedRoots(roots: string[]): string[] {
  const sorted = [...roots].sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const candidate of sorted) {
    const nested = kept.some(
      (parent) =>
        parent !== candidate && nestingRelative(parent, candidate) !== null,
    );
    if (!nested) {
      kept.push(candidate);
    }
  }
  return kept.sort();
}

/** Stable library keys derived from path, not list order. */
export function assignLibraryKeys(roots: string[]): Map<string, string> {
  const sortedRoots = [...roots].sort();
  const keys = new Map<string, string>();
  const usedKeys = new Set<string>();

  for (const root of sortedRoots) {
    const baseKey = basename(root) || 'library';
    let key = baseKey;

    if (usedKeys.has(key)) {
      const parent = basename(dirname(root));
      if (parent && parent !== '.' && parent !== '/') {
        key = `${parent}_${baseKey}`;
      }
    }

    let suffix = 2;
    const stem = key;
    while (usedKeys.has(key)) {
      key = `${stem}_${suffix}`;
      suffix += 1;
    }

    usedKeys.add(key);
    keys.set(root, key);
  }
  return keys;
}

export function buildLibraryPathLayout(roots: string[]): LibraryPathLayout {
  const keys = assignLibraryKeys(roots);
  return {
    roots,
    keys,
    multiRoot: roots.length > 1,
  };
}

export function prefixCataloguePath(
  key: string,
  relativePath: string,
  multiRoot: boolean,
): string {
  if (!multiRoot) {
    return relativePath.replace(/\\/g, '/');
  }
  const normalized = relativePath.replace(/\\/g, '/');
  return `${key}/${normalized}`;
}

export function stripCataloguePath(
  key: string,
  cataloguePath: string,
): string | null {
  const normalized = cataloguePath.replace(/\\/g, '/');
  const prefix = `${key}/`;
  if (normalized.startsWith(prefix)) {
    return normalized.slice(prefix.length);
  }
  if (normalized === key) {
    return '';
  }
  return null;
}

export function cataloguePathBelongsToRoot(
  cataloguePath: string,
  key: string,
  multiRoot: boolean,
): boolean {
  if (!multiRoot) {
    return true;
  }
  return stripCataloguePath(key, cataloguePath) !== null;
}

function resolveUnderRoot(root: string, relativePath: string): string | null {
  const absolute = resolve(root, relativePath);
  if (relativeInsideNormalized(root, absolute) === null) {
    return null;
  }
  return absolute;
}

/** Resolve a catalogue relative_path to an absolute file path. */
export function resolveUnderLibraries(
  relativePath: string,
  layout: LibraryPathLayout,
  legacyUnprefixedRoot?: string | null,
): string | null {
  const normalized = relativePath.replace(/\\/g, '/');

  if (!layout.multiRoot) {
    const root = layout.roots[0];
    if (!root) {
      return null;
    }
    return resolveUnderRoot(root, normalized);
  }

  for (const root of layout.roots) {
    const key = layout.keys.get(root);
    if (!key) {
      continue;
    }
    const stripped = stripCataloguePath(key, normalized);
    if (stripped != null) {
      return resolveUnderRoot(root, stripped);
    }
  }

  if (legacyUnprefixedRoot) {
    const hasKnownPrefix = [...layout.keys.values()].some((key) => {
      const stripped = stripCataloguePath(key, normalized);
      return stripped != null;
    });
    if (!hasKnownPrefix) {
      return resolveUnderRoot(legacyUnprefixedRoot, normalized);
    }
  }

  return null;
}

export function parseStoredScanRoots(raw: string | null | undefined): string[] | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (
        Array.isArray(parsed) &&
        parsed.every((entry) => typeof entry === 'string')
      ) {
        return parsed.map((entry) => normalizeRoot(entry));
      }
    } catch {
      return null;
    }
  }
  return [normalizeRoot(trimmed)];
}

export function serializeStoredScanRoots(roots: string[]): string {
  if (roots.length === 1) {
    return roots[0]!;
  }
  return JSON.stringify(roots);
}

export function sameRootSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const normalizedA = [...a].map(normalizeRoot).sort();
  const normalizedB = [...b].map(normalizeRoot).sort();
  return normalizedA.every((root, index) => root === normalizedB[index]);
}
