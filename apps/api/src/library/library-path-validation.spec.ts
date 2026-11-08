import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfiguredLibraryPaths } from './library-path-validation';

describe('validateConfiguredLibraryPaths', () => {
  it('marks missing paths as invalid', () => {
    const result = validateConfiguredLibraryPaths(
      ['/no/such/folder'],
      '/tmp',
    );
    expect(result.validRoots).toHaveLength(0);
    expect(result.invalid[0]).toMatchObject({
      path: '/no/such/folder',
      reason: 'Path does not exist',
    });
  });

  it('accepts a readable directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'karaokej-lib-'));
    try {
      const result = validateConfiguredLibraryPaths([dir], '/tmp');
      expect(result.invalid).toHaveLength(0);
      expect(result.validRoots).toEqual([dir]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
