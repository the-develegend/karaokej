import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtistBioService } from './artist-bio.service';
import { LibraryService } from '../library/library.service';
import { createMockSession } from '../test/mock-session';
import { createMockSeparation } from '../test/mock-separation';
import {
  createMockLibraryConfig,
  createMockLibrarySettings,
} from '../test/mock-library-deps';
import { createTestDb, insertTrack, TestDbService } from '../test/test-db';
import { AudioDbClient } from './audiodb.client';
import { DeezerClient } from './deezer.client';

describe('ArtistBioService', () => {
  let db: TestDbService;
  let cleanup: () => void;
  let library: LibraryService;
  let audiodb: {
    lookupArtistByMbid: ReturnType<typeof vi.fn>;
    searchArtist: ReturnType<typeof vi.fn>;
    lookupArtistById: ReturnType<typeof vi.fn>;
    fetchDiscographyByName: ReturnType<typeof vi.fn>;
    fetchDiscographyByMbid: ReturnType<typeof vi.fn>;
  };
  let deezer: {
    fetchTopTracksForArtist: ReturnType<typeof vi.fn>;
  };
  let service: ArtistBioService;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    const session = createMockSession(db);
    library = new LibraryService(
      db as never,
      createMockLibraryConfig() as never,
      session,
      createMockSeparation(),
      createMockLibrarySettings() as never,
    );
    audiodb = {
      lookupArtistByMbid: vi.fn(),
      searchArtist: vi.fn(),
      lookupArtistById: vi.fn(),
      fetchDiscographyByName: vi.fn(),
      fetchDiscographyByMbid: vi.fn(),
    };
    deezer = {
      fetchTopTracksForArtist: vi.fn(),
    };
    service = new ArtistBioService(
      db as never,
      library,
      audiodb as unknown as AudioDbClient,
      deezer as unknown as DeezerClient,
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('returns cached biography without calling TheAudioDB again', async () => {
    const trackId = insertTrack(db, {
      relativePath: 'coldplay/yellow.mp3',
      title: 'Yellow',
      artist: 'Coldplay',
    });
    db.raw
      .prepare(
        `INSERT INTO artist_bios (
           lookup_key, display_name, status, biography, fetched_at
         ) VALUES (?, ?, 'ready', ?, ?)`,
      )
      .run('name:coldplay', 'Coldplay', 'Cached bio', Date.now());

    const result = await service.getForTrack(trackId);

    expect(result.status).toBe('ready');
    expect(result.biography).toBe('Cached bio');
    expect(audiodb.searchArtist).not.toHaveBeenCalled();
    expect(audiodb.lookupArtistByMbid).not.toHaveBeenCalled();
  });

  it('persists not_found and blocks automatic refetch', async () => {
    audiodb.searchArtist.mockResolvedValue([]);
    const trackId = insertTrack(db, {
      relativePath: 'missing/artist.mp3',
      title: 'Song',
      artist: 'Missing Artist',
    });

    const first = await service.getForTrack(trackId);
    expect(first.status).toBe('not_found');
    expect(audiodb.searchArtist).toHaveBeenCalledTimes(1);

    audiodb.searchArtist.mockClear();
    const second = await service.getForTrack(trackId);
    expect(second.status).toBe('not_found');
    expect(audiodb.searchArtist).not.toHaveBeenCalled();
  });

  it('uses MusicBrainz lookup when track has artist MBID', async () => {
    const trackId = insertTrack(db, {
      relativePath: 'coldplay/yellow.mp3',
      title: 'Yellow',
      artist: 'Coldplay',
    });
    db.raw
      .prepare(`UPDATE tracks SET musicbrainz_artist_id = ? WHERE id = ?`)
      .run('cc197bad-dc9c-440d-a5b5-d52ba2e14234', trackId);

    audiodb.lookupArtistByMbid.mockResolvedValue({
      idArtist: '111239',
      strArtist: 'Coldplay',
      strBiographyEN: 'British rock band',
      strBiography: null,
      strGenre: 'Alternative Rock',
      strStyle: 'Rock/Pop',
      strMood: 'Happy',
      strCountry: 'London, England',
      intFormedYear: '1996',
      strMusicBrainzID: 'cc197bad-dc9c-440d-a5b5-d52ba2e14234',
    });

    const result = await service.getForTrack(trackId);

    expect(result.status).toBe('ready');
    expect(result.biography).toBe('British rock band');
    expect(audiodb.lookupArtistByMbid).toHaveBeenCalledWith(
      'cc197bad-dc9c-440d-a5b5-d52ba2e14234',
    );
    expect(audiodb.searchArtist).not.toHaveBeenCalled();
  });

  it('returns local ambiguity before calling TheAudioDB', async () => {
    const trackId = insertTrack(db, {
      relativePath: 'split/artist.mp3',
      title: 'Song',
      artist: 'Track Artist',
    });
    db.raw
      .prepare(`UPDATE tracks SET album_artist = ? WHERE id = ?`)
      .run('Album Artist', trackId);

    const result = await service.getForTrack(trackId);

    expect(result.status).toBe('ambiguous');
    expect(result.choices.map((choice) => choice.name)).toEqual([
      'Album Artist',
      'Track Artist',
    ]);
    expect(audiodb.searchArtist).not.toHaveBeenCalled();
  });

  it('fetches and caches extras on demand', async () => {
    const trackId = insertTrack(db, {
      relativePath: 'coldplay/yellow.mp3',
      title: 'Yellow',
      artist: 'Coldplay',
    });
    db.raw
      .prepare(
        `INSERT INTO artist_bios (
           lookup_key, display_name, status, biography, fetched_at
         ) VALUES (?, ?, 'ready', ?, ?)`,
      )
      .run('name:coldplay', 'Coldplay', 'Bio', Date.now());

    audiodb.fetchDiscographyByName.mockResolvedValue([
      { strAlbum: 'Parachutes', intYearReleased: '2000' },
    ]);
    deezer.fetchTopTracksForArtist.mockResolvedValue([
      { name: 'Yellow' },
      { name: 'Fix You' },
    ]);

    const result = await service.getExtrasForTrack(trackId);

    expect(result.albums).toEqual([{ name: 'Parachutes', year: '2000' }]);
    expect(result.topTracks).toEqual([{ name: 'Yellow' }, { name: 'Fix You' }]);
    expect(deezer.fetchTopTracksForArtist).toHaveBeenCalledWith('Coldplay');

    const row = db.raw
      .prepare(`SELECT albums_json, top_tracks_json FROM artist_bios WHERE lookup_key = ?`)
      .get('name:coldplay') as { albums_json: string; top_tracks_json: string };
    expect(JSON.parse(row.albums_json)).toEqual([
      { name: 'Parachutes', year: '2000' },
    ]);
    expect(JSON.parse(row.top_tracks_json)).toEqual([
      { name: 'Yellow' },
      { name: 'Fix You' },
    ]);
  });

  it('returns cached extras without calling Deezer again', async () => {
    const trackId = insertTrack(db, {
      relativePath: 'nirvana/come-as-you-are.mp3',
      title: 'Come as You Are',
      artist: 'Nirvana',
    });
    db.raw
      .prepare(
        `INSERT INTO artist_bios (
           lookup_key, display_name, status, biography, albums_json,
           top_tracks_json, fetched_at, extras_fetched_at
         ) VALUES (?, ?, 'ready', ?, ?, ?, ?, ?)`,
      )
      .run(
        'name:nirvana',
        'Nirvana',
        'Bio',
        JSON.stringify([{ name: 'Nevermind', year: '1991' }]),
        JSON.stringify([{ name: 'Come as You Are' }]),
        Date.now(),
        Date.now(),
      );

    const result = await service.getExtrasForTrack(trackId);

    expect(result.topTracks).toEqual([{ name: 'Come as You Are' }]);
    expect(deezer.fetchTopTracksForArtist).not.toHaveBeenCalled();
    expect(audiodb.fetchDiscographyByName).not.toHaveBeenCalled();
  });

  it('refresh always reloads extras from the APIs and persists them', async () => {
    const trackId = insertTrack(db, {
      relativePath: 'deftones/change.mp3',
      title: 'Change',
      artist: 'Deftones',
    });
    db.raw
      .prepare(
        `INSERT INTO artist_bios (
           lookup_key, display_name, status, biography, albums_json,
           top_tracks_json, fetched_at, extras_fetched_at
         ) VALUES (?, ?, 'ready', ?, ?, ?, ?, ?)`,
      )
      .run(
        'name:deftones',
        'Deftones',
        'Old bio',
        JSON.stringify([{ name: 'Around the Fur', year: '1997' }]),
        JSON.stringify([{ name: 'Cached Top' }]),
        Date.now(),
        Date.now(),
      );

    audiodb.searchArtist.mockResolvedValue([
      {
        idArtist: '111',
        strArtist: 'Deftones',
        strBiographyEN: 'American alternative metal band',
        strBiography: null,
        strGenre: 'Alternative Metal',
        strStyle: 'Nu Metal',
        strMood: 'Angry',
        strCountry: 'USA',
        intFormedYear: '1988',
        strMusicBrainzID: null,
      },
    ]);
    audiodb.fetchDiscographyByName.mockResolvedValue([
      { strAlbum: 'White Pony', intYearReleased: '2000' },
    ]);
    deezer.fetchTopTracksForArtist.mockResolvedValue([
      { name: 'Change (In the House of Flies)' },
      { name: 'My Own Summer (Shove It)' },
    ]);

    const result = await service.refreshForTrack(trackId);

    expect(result.biography).toBe('American alternative metal band');
    expect(result.albums).toEqual([{ name: 'White Pony', year: '2000' }]);
    expect(result.topTracks).toEqual([
      { name: 'Change (In the House of Flies)' },
      { name: 'My Own Summer (Shove It)' },
    ]);
    expect(audiodb.searchArtist).toHaveBeenCalled();
    expect(deezer.fetchTopTracksForArtist).toHaveBeenCalledWith('Deftones');

    const row = db.raw
      .prepare(
        `SELECT biography, albums_json, top_tracks_json FROM artist_bios WHERE lookup_key = ?`,
      )
      .get('name:deftones') as {
        biography: string;
        albums_json: string;
        top_tracks_json: string;
      };
    expect(row.biography).toBe('American alternative metal band');
    expect(JSON.parse(row.albums_json)).toEqual([
      { name: 'White Pony', year: '2000' },
    ]);
    expect(JSON.parse(row.top_tracks_json)).toEqual([
      { name: 'Change (In the House of Flies)' },
      { name: 'My Own Summer (Shove It)' },
    ]);
  });
});
