import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { InvalidLibraryPathDto } from '@karaokej/shared';

export interface LibraryPathValidationResult {
  validRoots: string[];
  invalid: InvalidLibraryPathDto[];
}

function resolveConfiguredPath(path: string, repoRoot: string): string {
  const trimmed = path.trim();
  return isAbsolute(trimmed) ? resolve(trimmed) : resolve(repoRoot, trimmed);
}

export function validateConfiguredLibraryPaths(
  configured: string[],
  repoRoot: string,
): LibraryPathValidationResult {
  const seenResolved = new Set<string>();
  const validRoots: string[] = [];
  const invalid: InvalidLibraryPathDto[] = [];

  for (const entry of configured) {
    const display = entry.trim();
    if (!display) {
      continue;
    }
    const resolved = resolveConfiguredPath(display, repoRoot);
    if (seenResolved.has(resolved)) {
      continue;
    }
    seenResolved.add(resolved);

    if (!existsSync(resolved)) {
      invalid.push({ path: display, reason: 'Path does not exist' });
      continue;
    }
    let stat;
    try {
      stat = statSync(resolved);
    } catch {
      invalid.push({ path: display, reason: 'Cannot read path status' });
      continue;
    }
    if (!stat.isDirectory()) {
      invalid.push({ path: display, reason: 'Not a folder' });
      continue;
    }
    try {
      accessSync(resolved, constants.R_OK);
    } catch {
      invalid.push({ path: display, reason: 'Folder is not readable' });
      continue;
    }
    validRoots.push(resolved);
  }

  return { validRoots, invalid };
}
