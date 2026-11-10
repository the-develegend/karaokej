import { open } from 'node:fs/promises';
import { extname } from 'node:path';

/** Karaoke-safe upper bound for track length (24 hours). */
export const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

export function sanitizeDurationMs(
  value: number | null | undefined,
): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }
  const rounded = Math.round(value);
  if (rounded <= 0 || rounded > MAX_DURATION_MS) {
    return null;
  }
  if (rounded > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return rounded;
}

/** Audio bytes kept after the tags so the parser can still probe the first frames. */
const AUDIO_PROBE_BYTES = 64 * 1024;
/** Guards against corrupt tag size fields forcing huge reads. */
const MAX_METADATA_READ_BYTES = 64 * 1024 * 1024;
/** Opus streams carry OpusHead and OpusTags before any audio packet. */
const OPUS_HEADER_PACKETS = 2;
const FLAC_BLOCK_PADDING = 1;
const FLAC_BLOCK_PICTURE = 6;

type ReadRange = (position: number, length: number) => Promise<Buffer>;

async function id3v2End(read: ReadRange, offset: number): Promise<number> {
  let position = offset;
  // Some files carry several ID3v2 tags back to back.
  for (let i = 0; i < 4; i += 1) {
    const header = await read(position, 10);
    if (header.length < 10 || header.toString('latin1', 0, 3) !== 'ID3') {
      break;
    }
    const size =
      ((header[6]! & 0x7f) << 21) |
      ((header[7]! & 0x7f) << 14) |
      ((header[8]! & 0x7f) << 7) |
      (header[9]! & 0x7f);
    const footer = header[5]! & 0x10 ? 10 : 0;
    position += 10 + size + footer;
  }
  return position;
}

async function flacMetadataEnd(
  read: ReadRange,
  offset: number,
  fileSize: number,
): Promise<number> {
  const magic = await read(offset, 4);
  if (magic.toString('latin1') !== 'fLaC') {
    return offset;
  }
  let position = offset + 4;
  let end = position;
  while (position + 4 <= fileSize) {
    const header = await read(position, 4);
    if (header.length < 4) {
      break;
    }
    const blockType = header[0]! & 0x7f;
    position += 4 + header.readUIntBE(1, 3);
    // Trailing PADDING / PICTURE blocks carry no tags; covers are skipped anyway.
    if (blockType !== FLAC_BLOCK_PADDING && blockType !== FLAC_BLOCK_PICTURE) {
      end = position;
    }
    if (header[0]! & 0x80) {
      break;
    }
  }
  return end;
}

async function oggHeaderPacketsEnd(
  read: ReadRange,
  offset: number,
  fileSize: number,
  packets: number,
): Promise<number> {
  let position = offset;
  let completed = 0;
  while (completed < packets && position + 27 <= fileSize) {
    const header = await read(position, 27);
    if (header.length < 27 || header.toString('latin1', 0, 4) !== 'OggS') {
      break;
    }
    const segmentCount = header[26]!;
    const lacing = await read(position + 27, segmentCount);
    if (lacing.length < segmentCount) {
      break;
    }
    let bodyLength = 0;
    for (const value of lacing) {
      bodyLength += value;
      if (value < 255) {
        completed += 1;
      }
    }
    position += 27 + segmentCount + bodyLength;
  }
  return position;
}

/** Byte offset where the leading tag/metadata section of the file ends. */
async function metadataEndOffset(
  read: ReadRange,
  ext: string,
  fileSize: number,
): Promise<number> {
  const afterId3 = await id3v2End(read, 0);
  switch (ext) {
    case '.flac':
      return flacMetadataEnd(read, afterId3, fileSize);
    case '.opus':
      return oggHeaderPacketsEnd(read, afterId3, fileSize, OPUS_HEADER_PACKETS);
    default:
      return afterId3;
  }
}

/**
 * Reads the start of an audio file for tag parsing: at least `maxBytes`, and
 * further when the tags themselves are larger (e.g. big embedded covers), so
 * the parser never sees a truncated tag.
 */
export async function readAudioHeaderBuffer(
  absolutePath: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; fileSize: number }> {
  const fh = await open(absolutePath, 'r');
  try {
    const { size } = await fh.stat();
    if (size <= 0) {
      return { buffer: Buffer.alloc(0), fileSize: 0 };
    }
    const headLength = Math.min(maxBytes, size);
    const head = Buffer.alloc(headLength);
    await fh.read(head, 0, headLength, 0);

    const read: ReadRange = async (position, length) => {
      if (position + length <= head.length) {
        return head.subarray(position, position + length);
      }
      const chunk = Buffer.alloc(length);
      const { bytesRead } = await fh.read(chunk, 0, length, position);
      return chunk.subarray(0, bytesRead);
    };
    const metadataEnd = await metadataEndOffset(
      read,
      extname(absolutePath).toLowerCase(),
      size,
    );
    const readLength = Math.min(
      size,
      Math.max(
        headLength,
        Math.min(metadataEnd + AUDIO_PROBE_BYTES, MAX_METADATA_READ_BYTES),
      ),
    );
    if (readLength <= headLength) {
      return { buffer: head, fileSize: size };
    }
    const buffer = Buffer.alloc(readLength);
    head.copy(buffer, 0);
    await fh.read(buffer, headLength, readLength - headLength, headLength);
    return { buffer, fileSize: size };
  } finally {
    await fh.close();
  }
}

export const HEADER_READ_BYTES: Record<string, number> = {
  '.mp3': 256 * 1024,
  '.flac': 64 * 1024,
  '.opus': 64 * 1024,
};

export const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.opus': 'audio/ogg',
};
