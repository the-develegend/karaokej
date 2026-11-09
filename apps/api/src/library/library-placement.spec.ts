import { describe, expect, it } from 'vitest';
import { buildLibraryPathLayout } from './library-paths';
import {
  classifyLibraryPlacement,
  matchesCanonicalLayoutPath,
  relativePathUnderMain,
  resolveMainRootAbsolute,
} from './library-placement';

describe('matchesCanonicalLayoutPath', () => {
  it('matches exact and conflict-suffixed filenames', () => {
    const canonical = 'A/Aerosmith/1989 - Pump/01 - Young Lust.opus';
    expect(matchesCanonicalLayoutPath(canonical, canonical)).toBe(true);
    expect(
      matchesCanonicalLayoutPath(
        'A/Aerosmith/1989 - Pump/01 - Young Lust (2).opus',
        canonical,
      ),
    ).toBe(true);
    expect(
      matchesCanonicalLayoutPath(
        'A/Aerosmith/1989 - Pump/01 - Young Lust (1).opus',
        canonical,
      ),
    ).toBe(false);
    expect(
      matchesCanonicalLayoutPath(
        'A/Aerosmith/1989 - Pump/02 - Young Lust.opus',
        canonical,
      ),
    ).toBe(false);
  });
});

describe('classifyLibraryPlacement', () => {
  const single = buildLibraryPathLayout(['/music']);
  const multi = buildLibraryPathLayout(['/music', '/inbox']);
  const mainRoot = '/music';
  const inboxRoot = '/inbox';

  const base = {
    title: 'Young Lust',
    artist: 'Aerosmith',
    albumArtist: null as string | null,
    album: 'Pump',
    year: 1989,
    trackNo: 1,
    format: 'opus',
  };

  it('marks canonical paths under main as organized', () => {
    expect(
      classifyLibraryPlacement({
        ...base,
        cataloguePath: 'A/Aerosmith/1989 - Pump/01 - Young Lust.opus',
        layout: single,
        mainRoot,
      }),
    ).toBe('organized');
  });

  it('treats conflict suffixes as organized', () => {
    expect(
      classifyLibraryPlacement({
        ...base,
        cataloguePath: 'A/Aerosmith/1989 - Pump/01 - Young Lust (3).opus',
        layout: single,
        mainRoot,
      }),
    ).toBe('organized');
  });

  it('marks wrong layout under main as in_main_unsorted', () => {
    expect(
      classifyLibraryPlacement({
        ...base,
        cataloguePath: 'Downloads/Young Lust.opus',
        layout: single,
        mainRoot,
      }),
    ).toBe('in_main_unsorted');
  });

  it('marks incomplete metadata under main as in_main_unsorted', () => {
    expect(
      classifyLibraryPlacement({
        ...base,
        album: 'Pump',
        year: null,
        cataloguePath: 'A/Aerosmith/Pump/01 - Young Lust.opus',
        layout: single,
        mainRoot,
      }),
    ).toBe('in_main_unsorted');
  });

  it('marks non-main multi-root paths as outside_main even when tidy', () => {
    const inboxKey = multi.keys.get(inboxRoot)!;
    expect(
      classifyLibraryPlacement({
        ...base,
        cataloguePath: `${inboxKey}/A/Aerosmith/1989 - Pump/01 - Young Lust.opus`,
        layout: multi,
        mainRoot,
      }),
    ).toBe('outside_main');
  });

  it('organizes multi-root paths under the main key', () => {
    const mainKey = multi.keys.get(mainRoot)!;
    expect(
      classifyLibraryPlacement({
        ...base,
        cataloguePath: `${mainKey}/A/Aerosmith/1989 - Pump/01 - Young Lust.opus`,
        layout: multi,
        mainRoot,
      }),
    ).toBe('organized');
  });

  it('returns outside_main when no main root is configured', () => {
    expect(
      classifyLibraryPlacement({
        ...base,
        cataloguePath: 'A/Aerosmith/1989 - Pump/01 - Young Lust.opus',
        layout: single,
        mainRoot: null,
      }),
    ).toBe('outside_main');
  });
});

describe('relativePathUnderMain / resolveMainRootAbsolute', () => {
  it('strips the main catalogue key in multi-root mode', () => {
    const layout = buildLibraryPathLayout(['/music', '/inbox']);
    expect(
      relativePathUnderMain('music/A/Song.mp3', layout, '/music'),
    ).toBe('A/Song.mp3');
    expect(relativePathUnderMain('inbox/x.mp3', layout, '/music')).toBeNull();
  });

  it('maps the settings main path to the layout root', () => {
    const layout = buildLibraryPathLayout(['/abs/music', '/abs/inbox']);
    expect(
      resolveMainRootAbsolute(['./music', './inbox'], './music', layout),
    ).toBe('/abs/music');
    expect(
      resolveMainRootAbsolute(['./music', './inbox'], './inbox', layout),
    ).toBe('/abs/inbox');
    expect(resolveMainRootAbsolute([], null, layout)).toBeNull();
  });
});
