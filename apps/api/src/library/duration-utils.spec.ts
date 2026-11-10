import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  HEADER_READ_BYTES,
  MAX_DURATION_MS,
  readAudioHeaderBuffer,
  sanitizeDurationMs,
} from './duration-utils';
import { readTrackMetadata } from './scan-metadata';

describe('sanitizeDurationMs', () => {
  it('accepts normal song lengths', () => {
    expect(sanitizeDurationMs(149_120)).toBe(149_120);
    expect(sanitizeDurationMs(149_120.7)).toBe(149_121);
  });

  it('rejects zero, NaN, and non-finite values', () => {
    expect(sanitizeDurationMs(0)).toBeNull();
    expect(sanitizeDurationMs(-1)).toBeNull();
    expect(sanitizeDurationMs(Number.NaN)).toBeNull();
    expect(sanitizeDurationMs(Number.POSITIVE_INFINITY)).toBeNull();
    expect(sanitizeDurationMs(null)).toBeNull();
    expect(sanitizeDurationMs(undefined)).toBeNull();
  });

  it('rejects the live Opus sentinel and values above the cap', () => {
    expect(sanitizeDurationMs(384307168202282304)).toBeNull();
    expect(sanitizeDurationMs(MAX_DURATION_MS + 1)).toBeNull();
  });

  it('accepts durations up to the karaoke cap', () => {
    expect(sanitizeDurationMs(MAX_DURATION_MS)).toBe(MAX_DURATION_MS);
  });
});

function id3v23Frame(id: string, body: Buffer): Buffer {
  const header = Buffer.alloc(10);
  header.write(id, 0, 'latin1');
  header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
}

function id3v23TextFrame(id: string, text: string): Buffer {
  return id3v23Frame(id, Buffer.concat([Buffer.from([0]), Buffer.from(text, 'latin1')]));
}

function id3v23Tag(frames: Buffer[]): Buffer {
  const body = Buffer.concat(frames);
  const size = body.length;
  const header = Buffer.from([
    0x49, 0x44, 0x33, 3, 0, 0,
    (size >> 21) & 0x7f,
    (size >> 14) & 0x7f,
    (size >> 7) & 0x7f,
    size & 0x7f,
  ]);
  return Buffer.concat([header, body]);
}

function flacBlock(type: number, length: number, last: boolean): Buffer {
  const block = Buffer.alloc(4 + length);
  block[0] = (last ? 0x80 : 0) | type;
  block.writeUIntBE(length, 1, 3);
  return block;
}

function oggPages(packets: Buffer[]): Buffer {
  const pages: Buffer[] = [];
  for (const packet of packets) {
    const lacing: number[] = [];
    let remaining = packet.length;
    while (remaining >= 255) {
      lacing.push(255);
      remaining -= 255;
    }
    lacing.push(remaining);
    let consumed = 0;
    for (let i = 0; i < lacing.length; i += 255) {
      const segments = lacing.slice(i, i + 255);
      const bodyLength = segments.reduce((sum, value) => sum + value, 0);
      const header = Buffer.alloc(27);
      header.write('OggS', 0, 'latin1');
      header[26] = segments.length;
      pages.push(
        header,
        Buffer.from(segments),
        packet.subarray(consumed, consumed + bodyLength),
      );
      consumed += bodyLength;
    }
  }
  return Buffer.concat(pages);
}

describe('readAudioHeaderBuffer', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'karaokej-header-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads past the default window when an ID3v2 tag is larger', async () => {
    const tag = id3v23Tag([
      id3v23Frame('PRIV', Buffer.concat([Buffer.from('cover\0'), Buffer.alloc(600 * 1024)])),
      id3v23TextFrame('TIT2', 'Media Vita'),
      id3v23TextFrame('TPE1', 'Real Artist'),
      id3v23TextFrame('TALB', 'Real Album'),
      id3v23TextFrame('TYER', '2024'),
    ]);
    const path = join(dir, '01 - Media Vita.mp3');
    await writeFile(path, Buffer.concat([tag, Buffer.alloc(512 * 1024)]));

    const { buffer } = await readAudioHeaderBuffer(path, HEADER_READ_BYTES['.mp3']!);
    expect(buffer.length).toBeGreaterThanOrEqual(tag.length);

    const { metadata } = await readTrackMetadata(
      path,
      'Artist/2024 - Folder Album/01 - Media Vita.mp3',
      { fsTimeoutMs: 5000 },
    );
    expect(metadata.title).toBe('Media Vita');
    expect(metadata.artist).toBe('Real Artist');
    expect(metadata.album).toBe('Real Album');
    expect(metadata.year).toBe(2024);
  });

  it('keeps the default window for small ID3v2 tags', async () => {
    const tag = id3v23Tag([id3v23TextFrame('TIT2', 'Small')]);
    const path = join(dir, 'small.mp3');
    await writeFile(path, Buffer.concat([tag, Buffer.alloc(1024 * 1024)]));

    const { buffer } = await readAudioHeaderBuffer(path, HEADER_READ_BYTES['.mp3']!);
    expect(buffer.length).toBe(HEADER_READ_BYTES['.mp3']);
  });

  it('reads FLAC comments that follow a large picture block', async () => {
    const head = Buffer.concat([
      Buffer.from('fLaC'),
      flacBlock(0, 34, false),
      flacBlock(6, 300 * 1024, false),
      flacBlock(4, 200, true),
    ]);
    const path = join(dir, 'picture-first.flac');
    await writeFile(path, Buffer.concat([head, Buffer.alloc(512 * 1024)]));

    const { buffer } = await readAudioHeaderBuffer(path, HEADER_READ_BYTES['.flac']!);
    expect(buffer.length).toBeGreaterThanOrEqual(head.length);
  });

  it('does not read a trailing FLAC picture block', async () => {
    const path = join(dir, 'picture-last.flac');
    await writeFile(
      path,
      Buffer.concat([
        Buffer.from('fLaC'),
        flacBlock(0, 34, false),
        flacBlock(4, 200, false),
        flacBlock(6, 300 * 1024, true),
        Buffer.alloc(512 * 1024),
      ]),
    );

    const { buffer } = await readAudioHeaderBuffer(path, HEADER_READ_BYTES['.flac']!);
    expect(buffer.length).toBeLessThan(100 * 1024);
  });

  it('reads an OpusTags packet spanning several Ogg pages', async () => {
    const head = oggPages([
      Buffer.concat([Buffer.from('OpusHead'), Buffer.alloc(11)]),
      Buffer.concat([Buffer.from('OpusTags'), Buffer.alloc(200 * 1024)]),
    ]);
    const path = join(dir, 'big-tags.opus');
    await writeFile(path, Buffer.concat([head, Buffer.alloc(512 * 1024)]));

    const { buffer } = await readAudioHeaderBuffer(path, HEADER_READ_BYTES['.opus']!);
    expect(buffer.length).toBeGreaterThanOrEqual(head.length);
  });
});
