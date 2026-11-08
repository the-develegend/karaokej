import { describe, expect, it } from 'vitest';
import {
  buildLibraryRelativePath,
  formatTrackFileName,
  letterFolderForArtist,
  sanitizePathSegment,
  validateLibraryLayoutMetadata,
  withConflictSuffix,
} from './library-path-layout';

describe('library-path-layout', () => {
  it('builds a canonical album path', () => {
    expect(
      buildLibraryRelativePath({
        title: 'Young Lust',
        artist: 'Aerosmith',
        albumArtist: null,
        album: 'Pump',
        year: 1989,
        trackNo: 1,
        fileExtension: '.opus',
      }),
    ).toBe('A/Aerosmith/1989 - Pump/01 - Young Lust.opus');
  });

  it('uses album artist when set', () => {
    expect(
      buildLibraryRelativePath({
        title: 'Song',
        artist: 'Various',
        albumArtist: 'Supergroup',
        album: 'Album',
        year: 2000,
        trackNo: 3,
        fileExtension: '.flac',
      }),
    ).toBe('S/Supergroup/2000 - Album/03 - Song.flac');
  });

  it('uses Singles without year when album empty', () => {
    expect(
      buildLibraryRelativePath({
        title: 'Hit',
        artist: 'Maggie Fletcher',
        albumArtist: null,
        album: null,
        year: null,
        trackNo: null,
        fileExtension: '.mp3',
      }),
    ).toBe('M/Maggie Fletcher/Singles/Hit.mp3');
  });

  it('places unknown artist under outlier folder', () => {
    expect(
      buildLibraryRelativePath({
        title: 'Mystery',
        artist: null,
        albumArtist: null,
        album: null,
        year: null,
        trackNo: 2,
        fileExtension: '.opus',
      }),
    ).toBe('Unknown Artist/Singles/02 - Mystery.opus');
  });

  it('uses digit letter folder for numbered artists', () => {
    expect(letterFolderForArtist('4 Non Blondes')).toBe('4');
  });

  it('pads track numbers and uses three digits from 100', () => {
    expect(formatTrackFileName('Long', 9, '.mp3')).toBe('09 - Long.mp3');
    expect(formatTrackFileName('Long', 100, '.mp3')).toBe('100 - Long.mp3');
    expect(formatTrackFileName('Long', null, '.mp3')).toBe('Long.mp3');
  });

  it('sanitizes illegal path characters', () => {
    expect(sanitizePathSegment('foo:bar?')).toBe('foobar');
  });

  it('requires year when album is set', () => {
    const errors = validateLibraryLayoutMetadata(
      {
        title: 'T',
        artist: 'A',
        albumArtist: null,
        album: 'Al',
        year: null,
        trackNo: 1,
        fileExtension: '.mp3',
      },
      true,
    );
    expect(errors.some((e) => e.field === 'year')).toBe(true);
  });

  it('applies conflict suffix before extension', () => {
    expect(withConflictSuffix('/a/01 - Song.mp3', 2)).toBe(
      '/a/01 - Song (2).mp3',
    );
  });
});
