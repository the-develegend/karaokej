import { describe, expect, it } from 'vitest';
import {
  formatAccumulatedDuration,
  formatClockDuration,
  formatCompareDuration,
  formatTrackSubtitle,
  karaokeStemBadge,
  lyricDurationMatches,
  metadataDurationCompareState,
} from './format';

describe('formatTrackSubtitle', () => {
  it('shows artist and album with year in parentheses', () => {
    expect(
      formatTrackSubtitle({
        artist: 'Armand van Helden',
        album: 'Nympho',
        year: 1999,
        genres: [],
      }),
    ).toBe('Armand van Helden · Nympho (1999)');
  });

  it('shows year only when album is missing', () => {
    expect(
      formatTrackSubtitle({
        artist: 'Artist',
        album: null,
        year: 2005,
        genres: [],
      }),
    ).toBe('Artist · 2005');
  });

  it('shows album without year when year is missing', () => {
    expect(
      formatTrackSubtitle({
        artist: 'Artist',
        album: 'Album',
        year: null,
        genres: [],
      }),
    ).toBe('Artist · Album');
  });

  it('shows up to three genres', () => {
    expect(
      formatTrackSubtitle({
        artist: 'Artist',
        album: 'Album',
        year: 1999,
        genres: ['House', 'Disco', 'Funk'],
      }),
    ).toBe('Artist · Album (1999) · House, Disco, Funk');
  });

  it('appends +N when more than three genres', () => {
    expect(
      formatTrackSubtitle({
        artist: 'Artist',
        album: 'Album',
        year: 1999,
        genres: ['House', 'Disco', 'Funk', 'Pop'],
      }),
    ).toBe('Artist · Album (1999) · House, Disco, Funk +1');
  });

  it('uses Unknown artist when artist is null', () => {
    expect(
      formatTrackSubtitle({
        artist: null,
        album: null,
        year: null,
        genres: ['Rock'],
      }),
    ).toBe('Unknown artist · Rock');
  });
});

describe('karaokeStemBadge', () => {
  it('returns ready badge', () => {
    expect(karaokeStemBadge('ready')).toMatchObject({
      label: 'AI stem',
      tone: 'ok',
      show: true,
    });
  });

  it('returns pending badge', () => {
    expect(karaokeStemBadge('pending')).toMatchObject({
      label: 'Queued',
      tone: 'muted',
      show: true,
    });
  });

  it('returns processing badge with animation flag', () => {
    expect(karaokeStemBadge('processing')).toMatchObject({
      label: 'Separating…',
      tone: 'warn',
      show: true,
      processing: true,
    });
  });

  it('returns null for hidden statuses', () => {
    expect(karaokeStemBadge(null)).toBeNull();
    expect(karaokeStemBadge('none')).toBeNull();
    expect(karaokeStemBadge('failed')).toBeNull();
    expect(karaokeStemBadge('unsupported')).toBeNull();
  });
});

describe('formatClockDuration', () => {
  it('formats sub-hour totals as m:ss', () => {
    expect(formatClockDuration(90_000)).toBe('1:30');
    expect(formatClockDuration(3_590_000)).toBe('59:50');
  });

  it('formats hour-plus totals as h:mm:ss', () => {
    expect(formatClockDuration(3_600_000)).toBe('1:00:00');
    expect(formatClockDuration(5_461_000)).toBe('1:31:01');
  });

  it('returns placeholder for missing values', () => {
    expect(formatClockDuration(null)).toBe('–:––');
  });
});

describe('formatAccumulatedDuration', () => {
  it('formats known totals', () => {
    expect(formatAccumulatedDuration({ totalMs: 1_930_000, unknownCount: 0 })).toBe(
      '32:10',
    );
  });

  it('appends incomplete hint when some durations are unknown', () => {
    expect(formatAccumulatedDuration({ totalMs: 1_930_000, unknownCount: 2 })).toBe(
      '32:10 + ?',
    );
    expect(formatAccumulatedDuration({ totalMs: 0, unknownCount: 3 })).toBe('–:–– + ?');
  });

  it('returns null for empty lists', () => {
    expect(formatAccumulatedDuration({ totalMs: 0, unknownCount: 0 })).toBeNull();
  });
});

describe('metadataDurationCompareState', () => {
  it('returns unknown when either side is missing', () => {
    expect(metadataDurationCompareState(null, 180_000)).toBe('unknown');
    expect(metadataDurationCompareState(180_000, null)).toBe('unknown');
  });

  it('returns match within two seconds', () => {
    expect(metadataDurationCompareState(180_000, 181_500)).toBe('match');
  });

  it('returns mismatch outside tolerance', () => {
    expect(metadataDurationCompareState(180_000, 185_000)).toBe('mismatch');
  });
});

describe('formatCompareDuration', () => {
  it('uses em dash when duration is unknown', () => {
    expect(formatCompareDuration(null)).toBe('—');
  });

  it('formats known durations as clock text', () => {
    expect(formatCompareDuration(245_000)).toBe('4:05');
  });
});

describe('lyricDurationMatches', () => {
  it('matches within two seconds', () => {
    expect(lyricDurationMatches(180_000, 181_500)).toBe(true);
    expect(lyricDurationMatches(180_000, 178_000)).toBe(true);
  });

  it('does not match outside tolerance', () => {
    expect(lyricDurationMatches(180_000, 183_500)).toBe(false);
  });

  it('returns false when either duration is missing', () => {
    expect(lyricDurationMatches(null, 180_000)).toBe(false);
    expect(lyricDurationMatches(180_000, null)).toBe(false);
  });
});
