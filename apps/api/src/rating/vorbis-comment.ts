export interface VorbisComment {
  key: string;
  value: string;
}

export function parseVorbisCommentPacket(data: Buffer): {
  vendor: string;
  comments: VorbisComment[];
} {
  if (data.length < 8) {
    throw new Error('Vorbis comment packet is too short');
  }
  let offset = 0;
  const vendorLen = data.readUInt32LE(offset);
  offset += 4;
  if (offset + vendorLen + 4 > data.length) {
    throw new Error('Vorbis comment vendor is truncated');
  }
  const vendor = data.subarray(offset, offset + vendorLen).toString('utf8');
  offset += vendorLen;
  const count = data.readUInt32LE(offset);
  offset += 4;
  const comments: VorbisComment[] = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 4 > data.length) {
      throw new Error('Vorbis comment list is truncated');
    }
    const len = data.readUInt32LE(offset);
    offset += 4;
    if (offset + len > data.length) {
      throw new Error('Vorbis comment entry is truncated');
    }
    const entry = data.subarray(offset, offset + len).toString('utf8');
    offset += len;
    const eq = entry.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    comments.push({
      key: entry.slice(0, eq),
      value: entry.slice(eq + 1),
    });
  }
  return { vendor, comments };
}

export function serializeVorbisCommentPacket(
  vendor: string,
  comments: VorbisComment[],
): Buffer {
  const vendorBuf = Buffer.from(vendor, 'utf8');
  const parts = comments.map((comment) =>
    Buffer.from(`${comment.key}=${comment.value}`, 'utf8'),
  );
  const size =
    4 +
    vendorBuf.length +
    4 +
    parts.reduce((sum, part) => sum + 4 + part.length, 0);
  const out = Buffer.alloc(size);
  let offset = 0;
  out.writeUInt32LE(vendorBuf.length, offset);
  offset += 4;
  vendorBuf.copy(out, offset);
  offset += vendorBuf.length;
  out.writeUInt32LE(parts.length, offset);
  offset += 4;
  for (const part of parts) {
    out.writeUInt32LE(part.length, offset);
    offset += 4;
    part.copy(out, offset);
    offset += part.length;
  }
  return out;
}

export function setMoodComments(
  comments: VorbisComment[],
  values: string[],
): VorbisComment[] {
  const next = comments.filter((comment) => comment.key.toUpperCase() !== 'MOOD');
  for (const value of values) {
    next.push({ key: 'MOOD', value });
  }
  return next;
}

export function setRatingComment(
  comments: VorbisComment[],
  rating: number,
): VorbisComment[] {
  const next = comments.filter((comment) => comment.key.toUpperCase() !== 'RATING');
  next.push({ key: 'RATING', value: String(rating) });
  return next;
}

const METADATA_COMMENT_KEYS = new Set([
  'TITLE',
  'ARTIST',
  'ALBUM',
  'ALBUMARTIST',
  'TRACKNUMBER',
  'DATE',
  'YEAR',
  'GENRE',
  'RATING',
  'MUSICBRAINZ_ARTISTID',
  'MUSICBRAINZ_TRACKID',
  'MUSICBRAINZ_ALBUMID',
  'ISRC',
]);

export interface VorbisMetadataInput {
  title: string;
  artist: string | null;
  album: string | null;
  albumArtist: string | null;
  trackNo: number | null;
  year: number | null;
  genres: string[];
  rating: number;
  musicbrainzArtistId: string | null;
  musicbrainzRecordingId: string | null;
  musicbrainzReleaseId: string | null;
  isrc: string | null;
}

export function applyMetadataComments(
  comments: VorbisComment[],
  metadata: VorbisMetadataInput,
): VorbisComment[] {
  const next = comments.filter(
    (comment) => !METADATA_COMMENT_KEYS.has(comment.key.toUpperCase()),
  );
  next.push({ key: 'TITLE', value: metadata.title });
  if (metadata.artist) {
    next.push({ key: 'ARTIST', value: metadata.artist });
  }
  if (metadata.album) {
    next.push({ key: 'ALBUM', value: metadata.album });
  }
  if (metadata.albumArtist) {
    next.push({ key: 'ALBUMARTIST', value: metadata.albumArtist });
  }
  if (metadata.trackNo != null) {
    next.push({ key: 'TRACKNUMBER', value: String(metadata.trackNo) });
  }
  if (metadata.year != null) {
    next.push({ key: 'DATE', value: String(metadata.year) });
  }
  for (const genre of metadata.genres) {
    const trimmed = genre.trim();
    if (trimmed) {
      next.push({ key: 'GENRE', value: trimmed });
    }
  }
  next.push({ key: 'RATING', value: String(metadata.rating) });
  if (metadata.musicbrainzArtistId) {
    next.push({
      key: 'MUSICBRAINZ_ARTISTID',
      value: metadata.musicbrainzArtistId,
    });
  }
  if (metadata.musicbrainzRecordingId) {
    next.push({
      key: 'MUSICBRAINZ_TRACKID',
      value: metadata.musicbrainzRecordingId,
    });
  }
  if (metadata.musicbrainzReleaseId) {
    next.push({
      key: 'MUSICBRAINZ_ALBUMID',
      value: metadata.musicbrainzReleaseId,
    });
  }
  if (metadata.isrc) {
    next.push({ key: 'ISRC', value: metadata.isrc });
  }
  return next;
}
