import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PlaylistsService } from './playlists.service';
import { QueueService } from '../queue/queue.service';
import { LibraryService } from '../library/library.service';
import { createMockSession } from '../test/mock-session';
import { createMockSeparation } from '../test/mock-separation';
import {
  createMockLibraryConfig,
  createMockLibrarySettings,
} from '../test/mock-library-deps';
import { createTestDb, insertTrack, TestDbService } from '../test/test-db';

describe('PlaylistsService', () => {
  let db: TestDbService;
  let cleanup: () => void;
  let playlists: PlaylistsService;
  let queue: QueueService;
  let library: LibraryService;
  let trackA: number;
  let trackB: number;

  beforeEach(() => {
    ({ db, cleanup } = createTestDb());
    const session = createMockSession(db);
    const playback = { tryLoopWrapAfterLastItem: vi.fn() };
    queue = new QueueService(db as never, session, playback as never);
    playlists = new PlaylistsService(db as never, queue);
    library = new LibraryService(
      db as never,
      createMockLibraryConfig() as never,
      session,
      createMockSeparation(),
      createMockLibrarySettings() as never,
    );
    trackA = insertTrack(db, {
      relativePath: 'a/song-a.mp3',
      title: 'Song A',
      artist: 'Artist A',
    });
    trackB = insertTrack(db, {
      relativePath: 'b/song-b.mp3',
      title: 'Song B',
      artist: 'Artist B',
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('creates, renames, and deletes playlists', () => {
    const created = playlists.create({ name: 'Road trip' });
    expect(created.name).toBe('Road trip');
    expect(created.items).toEqual([]);

    const renamed = playlists.update(created.id, { name: 'Summer drive' });
    expect(renamed.name).toBe('Summer drive');

    playlists.delete(created.id);
    expect(() => playlists.get(created.id)).toThrow(NotFoundException);
    const orphanItems = db.raw
      .prepare(`SELECT COUNT(*) AS n FROM playlist_items WHERE playlist_id = ?`)
      .get(created.id) as { n: number };
    expect(orphanItems.n).toBe(0);
  });

  it('inserts an item before an existing playlist item', () => {
    const playlist = playlists.create({ name: 'Insert before' });
    playlists.addItem(playlist.id, trackA);
    const withSecond = playlists.addItem(playlist.id, trackB);
    const beforeId = withSecond.items[1]!.id;

    const after = playlists.addItem(playlist.id, trackA, beforeId);
    expect(after.items.map((item) => item.track.id)).toEqual([
      trackA,
      trackA,
      trackB,
    ]);
    expect(after.items.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it('adds items, allows duplicates, and preserves order', () => {
    const playlist = playlists.create({ name: 'Duplicates' });
    playlists.addItem(playlist.id, trackA);
    playlists.addItem(playlist.id, trackB);
    playlists.addItem(playlist.id, trackA);

    const detail = playlists.get(playlist.id);
    expect(detail.items).toHaveLength(3);
    expect(detail.items.map((item) => item.track.id)).toEqual([
      trackA,
      trackB,
      trackA,
    ]);
    expect(detail.items.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it('removes items and reindexes positions', () => {
    const playlist = playlists.create({ name: 'Reorder me' });
    playlists.addItem(playlist.id, trackA);
    playlists.addItem(playlist.id, trackB);
    const middle = playlists.addItem(playlist.id, trackA);
    const middleId = middle.items[1]!.id;

    const afterRemove = playlists.removeItem(playlist.id, middleId);
    expect(afterRemove.items).toHaveLength(2);
    expect(afterRemove.items.map((item) => item.position)).toEqual([1, 2]);
    expect(afterRemove.items.map((item) => item.track.id)).toEqual([trackA, trackA]);
  });

  it('reorders items deterministically', () => {
    const playlist = playlists.create({ name: 'Shuffle back' });
    const withItems = playlists.addItem(playlist.id, trackA);
    const second = playlists.addItem(withItems.id, trackB);
    const third = playlists.addItem(second.id, trackA);
    const ids = third.items.map((item) => item.id);

    const reordered = playlists.reorderItems(third.id, [ids[2]!, ids[0]!, ids[1]!]);
    expect(reordered.items.map((item) => item.track.id)).toEqual([
      trackA,
      trackA,
      trackB,
    ]);
  });

  it('aggregates duration totals in playlist summaries', () => {
    const trackWithDuration = insertTrack(db, {
      relativePath: 'c/long.mp3',
      title: 'Long Song',
      artist: 'Artist C',
      durationMs: 180_000,
    });
    const trackUnknown = insertTrack(db, {
      relativePath: 'd/unknown.mp3',
      title: 'Unknown Length',
      artist: 'Artist D',
      durationMs: null,
    });
    const playlist = playlists.create({ name: 'Mix' });
    playlists.addItem(playlist.id, trackWithDuration);
    playlists.addItem(playlist.id, trackUnknown);
    playlists.addItem(playlist.id, trackWithDuration);

    const listed = playlists.list().find((entry) => entry.id === playlist.id);
    expect(listed).toMatchObject({
      itemCount: 3,
      totalDurationMs: 360_000,
      unknownDurationCount: 1,
    });
  });

  it('aggregates duration totals in playlist summaries', () => {
    const trackWithDuration = insertTrack(db, {
      relativePath: 'c/long.mp3',
      title: 'Long Song',
      artist: 'Artist C',
      durationMs: 180_000,
    });
    const trackUnknown = insertTrack(db, {
      relativePath: 'd/unknown.mp3',
      title: 'Unknown Length',
      artist: 'Artist D',
      durationMs: null,
    });
    const playlist = playlists.create({ name: 'Mix' });
    playlists.addItem(playlist.id, trackWithDuration);
    playlists.addItem(playlist.id, trackUnknown);
    playlists.addItem(playlist.id, trackWithDuration);

    const listed = playlists.list().find((entry) => entry.id === playlist.id);
    expect(listed).toMatchObject({
      itemCount: 3,
      totalDurationMs: 360_000,
      unknownDurationCount: 1,
    });
  });

  it('rejects unknown track ids when adding items', () => {
    const playlist = playlists.create({ name: 'Strict' });
    expect(() => playlists.addItem(playlist.id, 99999)).toThrow(NotFoundException);
  });

  it('keeps playlist items when tracks become unavailable', () => {
    const playlist = playlists.create({ name: 'Missing files' });
    playlists.addItem(playlist.id, trackA);
    db.raw
      .prepare(`UPDATE tracks SET available = 0 WHERE id = ?`)
      .run(trackA);

    const detail = playlists.get(playlist.id);
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]!.available).toBe(false);
    expect(detail.items[0]!.track.title).toBe('Song A');
  });

  it('restores playlist usability when the same path becomes available again', () => {
    const playlist = playlists.create({ name: 'Returns' });
    playlists.addItem(playlist.id, trackA);
    db.raw
      .prepare(`UPDATE tracks SET available = 0 WHERE id = ?`)
      .run(trackA);

    db.raw
      .prepare(
        `UPDATE tracks SET available = 1, updated_at = ? WHERE relative_path = ?`,
      )
      .run(Date.now(), 'a/song-a.mp3');

    const detail = playlists.get(playlist.id);
    expect(detail.items[0]!.available).toBe(true);
    expect(detail.items[0]!.track.id).toBe(trackA);
  });

  it('keeps playlist items on the old id when path changes create a new track row', () => {
    const playlist = playlists.create({ name: 'Moved file' });
    playlists.addItem(playlist.id, trackA);
    db.raw
      .prepare(`UPDATE tracks SET available = 0 WHERE id = ?`)
      .run(trackA);
    const newTrackId = insertTrack(db, {
      relativePath: 'z/renamed-a.mp3',
      title: 'Song A',
      artist: 'Artist A',
    });

    const detail = playlists.get(playlist.id);
    expect(detail.items[0]!.track.id).toBe(trackA);
    expect(detail.items[0]!.available).toBe(false);
    expect(newTrackId).not.toBe(trackA);
  });

  it('loads replace mode into the queue without mutating the playlist', () => {
    const playlist = playlists.create({ name: 'Play me' });
    playlists.addItem(playlist.id, trackA);
    playlists.addItem(playlist.id, trackB);
    const before = playlists.get(playlist.id);

    const loaded = playlists.loadIntoQueue(playlist.id, 'replace');
    expect(loaded).toHaveLength(2);
    expect(loaded.map((item) => item.track.id)).toEqual([trackA, trackB]);

    const after = playlists.get(playlist.id);
    expect(after.items.map((item) => item.id)).toEqual(
      before.items.map((item) => item.id),
    );

    const playback = db.raw
      .prepare(`SELECT status, current_queue_item_id FROM playback_state WHERE id = 1`)
      .get() as { status: string; current_queue_item_id: number | null };
    expect(playback.status).toBe('playing');
    expect(playback.current_queue_item_id).toBe(loaded[0]!.id);
  });

  it('appends playable items without replacing existing queue entries', () => {
    queue.add(trackA);
    const playlist = playlists.create({ name: 'Append' });
    playlists.addItem(playlist.id, trackB);

    const loaded = playlists.loadIntoQueue(playlist.id, 'append');
    expect(loaded).toHaveLength(2);
    expect(loaded.map((item) => item.track.id)).toEqual([trackA, trackB]);
  });

  it('skips unavailable items when loading into the queue', () => {
    const playlist = playlists.create({ name: 'Partial' });
    playlists.addItem(playlist.id, trackA);
    playlists.addItem(playlist.id, trackB);
    db.raw
      .prepare(`UPDATE tracks SET available = 0 WHERE id = ?`)
      .run(trackA);

    const loaded = playlists.loadIntoQueue(playlist.id, 'replace');
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.track.id).toBe(trackB);
  });

  it('does not mutate track metadata when editing playlists', () => {
    const playlist = playlists.create({ name: 'Hands off' });
    playlists.addItem(playlist.id, trackA);
    playlists.update(playlist.id, { name: 'Renamed playlist', description: 'Notes' });
    playlists.reorderItems(
      playlist.id,
      playlists.get(playlist.id).items.map((item) => item.id),
    );

    const track = db.raw
      .prepare(`SELECT title, artist, album, relative_path, rating FROM tracks WHERE id = ?`)
      .get(trackA) as {
      title: string;
      artist: string | null;
      album: string | null;
      relative_path: string;
      rating: number | null;
    };
    expect(track).toMatchObject({
      title: 'Song A',
      artist: 'Artist A',
      relative_path: 'a/song-a.mp3',
    });
  });

  it('does not mutate playlist items when reordering the queue', () => {
    const playlist = playlists.create({ name: 'Queue isolation' });
    playlists.addItem(playlist.id, trackA);
    playlists.addItem(playlist.id, trackB);
    const playlistBefore = playlists.get(playlist.id);

    queue.add(trackA);
    queue.add(trackB);
    const queueItems = queue.list();
    queue.reorder([queueItems[1]!.id, queueItems[0]!.id]);

    const playlistAfter = playlists.get(playlist.id);
    expect(playlistAfter.items.map((item) => item.id)).toEqual(
      playlistBefore.items.map((item) => item.id),
    );
  });

  it('hides unavailable tracks from library search but keeps getTrack', () => {
    db.raw
      .prepare(`UPDATE tracks SET available = 0 WHERE id = ?`)
      .run(trackA);

    const page = library.search('', 1, 50);
    expect(page.items.some((track) => track.id === trackA)).toBe(false);
    expect(library.getTrack(trackA)?.title).toBe('Song A');
  });

  it('removes unavailable tracks from the queue but not playlists', () => {
    queue.add(trackA);
    const playlist = playlists.create({ name: 'Still here' });
    playlists.addItem(playlist.id, trackA);

    db.raw
      .prepare(`UPDATE tracks SET available = 0 WHERE id = ?`)
      .run(trackA);
    db.raw.prepare(`DELETE FROM queue_items WHERE track_id = ?`).run(trackA);

    expect(queue.list()).toHaveLength(0);
    expect(playlists.get(playlist.id).items).toHaveLength(1);
  });

  it('adds multiple tracks to a playlist in order', () => {
    const playlist = playlists.create({ name: 'Batch' });
    playlists.addItem(playlist.id, trackA);

    const detail = playlists.addItems(playlist.id, [trackB, trackA]);

    expect(detail.items.map((item) => item.track.id)).toEqual([
      trackA,
      trackB,
      trackA,
    ]);
  });

  it('preserves playlist references when rebasing catalogue paths in place', () => {
    const playlist = playlists.create({ name: 'Rebased' });
    playlists.addItem(playlist.id, trackA);

    db.raw
      .prepare(`UPDATE tracks SET relative_path = ?, updated_at = ? WHERE id = ?`)
      .run('new-root/song-a.mp3', Date.now(), trackA);

    const detail = playlists.get(playlist.id);
    expect(detail.items[0]!.track.id).toBe(trackA);
    expect(detail.items[0]!.track.relativePath).toBe('new-root/song-a.mp3');
  });
});
