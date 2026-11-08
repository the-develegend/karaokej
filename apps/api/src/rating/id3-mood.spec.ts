import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import NodeID3 from 'node-id3';
import { readId3Region } from './id3-region';
import { readMoodValues } from './id3-mood';
import { writeMp3Metadata, writeMp3Moods, writeMp3Rating } from './mp3-tags';
import { moodValuesFromNative } from '../tags/mood-values';

const AUDIO = Buffer.concat([
  Buffer.from([0xff, 0xfb, 0x90, 0x00]),
  Buffer.alloc(2048, 0x55),
]);

describe('mp3 mood', () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mp3-mood-'));
    target = join(dir, 'song.mp3');
    const tagged = NodeID3.update(
      {
        title: 'Asylum Walk',
        artist: 'Declaime',
        genre: 'Hip-Hop',
        popularimeter: { email: 'karaokej', rating: 196, counter: 2 },
      },
      AUDIO,
    );
    if (tagged instanceof Error) {
      throw tagged;
    }
    writeFileSync(target, tagged);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes NUL-separated moods and marks the tag ID3v2.4', async () => {
    await writeMp3Moods(target, ['Party', 'Duet']);

    const written = readFileSync(target);
    expect(written[3]).toBe(4);
    expect(readMoodValues(written)).toEqual(['Party', 'Duet']);
    const tags = NodeID3.read(written);
    expect(tags.title).toBe('Asylum Walk');
    expect(tags.artist).toBe('Declaime');
    expect(tags.genre).toBe('Hip-Hop');
    expect(tags.popularimeter?.rating).toBe(196);
    expect(readId3Region(written)?.totalBytes).toBeGreaterThan(10);

    const { parseBuffer } = await import('music-metadata');
    const meta = await parseBuffer(written, { mimeType: 'audio/mpeg' }, { duration: false, skipCovers: true });
    expect(moodValuesFromNative(meta.native as never)).toEqual(['Party', 'Duet']);
  });

  it('keeps moods when a rating or metadata write rewrites the tag', async () => {
    await writeMp3Moods(target, ['Party', 'Duet']);
    const afterMood = readFileSync(target);
    const moodOffset = readId3Region(afterMood)!.totalBytes;

    await writeMp3Rating(target, 4);
    await writeMp3Metadata(target, {
      title: 'Asylum Walk',
      artist: 'Declaime',
      album: 'Album',
      albumArtist: null,
      trackNo: 1,
      year: 2023,
      genres: ['Hip-Hop'],
      rating: 4,
      musicbrainzArtistId: null,
      musicbrainzRecordingId: null,
      musicbrainzReleaseId: null,
      isrc: null,
    });

    const written = readFileSync(target);
    expect(written[3]).toBe(4);
    expect(readMoodValues(written)).toEqual(['Party', 'Duet']);
    expect(NodeID3.read(written).title).toBe('Asylum Walk');
    expect(NodeID3.read(written).artist).toBe('Declaime');
    expect(NodeID3.read(written).album).toBe('Album');
    expect(written.subarray(readId3Region(written)!.totalBytes)).toEqual(
      afterMood.subarray(moodOffset),
    );
  });
});
