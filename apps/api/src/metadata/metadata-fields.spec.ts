import { describe, expect, it } from 'vitest';
import {
  editableFromParsed,
  metadataEquals,
  normalizeEditableMetadata,
} from './metadata-fields';

describe('metadata-fields', () => {
  it('normalizes editable metadata from partial input', () => {
    const normalized = normalizeEditableMetadata({
      title: '  Song  ',
      artist: ' Artist ',
      album: '',
      genres: [' Pop ', 'pop', 'Rock'],
      rating: 11,
    });
    expect(normalized).toEqual({
      title: 'Song',
      artist: 'Artist',
      album: null,
      albumArtist: null,
      trackNo: null,
      year: null,
      genres: ['Pop', 'Rock'],
      rating: 10,
      musicbrainzArtistId: null,
      musicbrainzRecordingId: null,
      musicbrainzReleaseId: null,
      isrc: null,
    });
  });

  it('detects metadata equality', () => {
    const a = editableFromParsed({
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      albumArtist: null,
      trackNo: 1,
      durationMs: 1000,
      rating: 6,
      year: 1999,
      genres: ['Pop'],
      musicbrainzArtistId: null,
      musicbrainzRecordingId: null,
      musicbrainzReleaseId: null,
      isrc: null,
      moodValues: [],
    });
    const b = { ...a, genres: ['Pop'] };
    expect(metadataEquals(a, b)).toBe(true);
    expect(metadataEquals(a, { ...b, title: 'Other' })).toBe(false);
  });
});
