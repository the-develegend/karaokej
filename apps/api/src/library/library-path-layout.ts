import { basename, dirname, extname, join } from 'node:path';

const UNKNOWN_ARTIST_FOLDER = 'Unknown Artist';
const SINGLES_ALBUM_FOLDER = 'Singles';
const ILLEGAL_SEGMENT = /[\\/:*?"<>|]/g;
const PLAYLISTS_FOLDER = 'Playlists';

export interface LibraryLayoutMetadata {
  title: string;
  artist: string | null;
  albumArtist: string | null;
  album: string | null;
  year: number | null;
  trackNo: number | null;
  fileExtension: string;
}

export type LibraryLayoutField =
  | 'title'
  | 'year'
  | 'mainLibraryPath'
  | 'path';

export interface LibraryLayoutValidationError {
  field: LibraryLayoutField;
  message: string;
}

export function trimMetadata(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function sanitizePathSegment(segment: string): string {
  let out = segment.replace(ILLEGAL_SEGMENT, '').trim();
  while (out.endsWith('.') || out.endsWith(' ')) {
    out = out.slice(0, -1);
  }
  return out;
}

export function artistFolderName(
  albumArtist: string | null,
  artist: string | null,
): string {
  const chosen = trimMetadata(albumArtist) ?? trimMetadata(artist);
  if (!chosen) {
    return UNKNOWN_ARTIST_FOLDER;
  }
  return sanitizePathSegment(chosen);
}

export function isUnknownArtistFolder(artistFolder: string): boolean {
  return artistFolder === UNKNOWN_ARTIST_FOLDER;
}

export function letterFolderForArtist(artistFolder: string): string {
  if (isUnknownArtistFolder(artistFolder)) {
    return '';
  }
  const first = artistFolder.charAt(0);
  if (/[a-zA-Z]/.test(first)) {
    return first.toUpperCase();
  }
  if (/[0-9]/.test(first)) {
    return first;
  }
  return '#';
}

export function albumFolderName(
  album: string | null,
  year: number | null,
): string | null {
  const trimmedAlbum = trimMetadata(album);
  if (!trimmedAlbum) {
    return SINGLES_ALBUM_FOLDER;
  }
  if (year == null || !Number.isInteger(year)) {
    return null;
  }
  const albumSegment = sanitizePathSegment(trimmedAlbum);
  return `${year} - ${albumSegment}`;
}

export function formatTrackFileName(
  title: string,
  trackNo: number | null,
  extensionWithDot: string,
): string {
  const safeTitle = sanitizePathSegment(title.trim());
  const ext =
    extensionWithDot.startsWith('.') || extensionWithDot === ''
      ? extensionWithDot
      : `.${extensionWithDot}`;
  if (trackNo != null && Number.isInteger(trackNo) && trackNo > 0) {
    const padded =
      trackNo >= 100
        ? String(trackNo)
        : String(trackNo).padStart(2, '0');
    return `${padded} - ${safeTitle}${ext}`;
  }
  return `${safeTitle}${ext}`;
}

export function validateLibraryLayoutMetadata(
  metadata: LibraryLayoutMetadata,
  mainLibraryConfigured: boolean,
): LibraryLayoutValidationError[] {
  const errors: LibraryLayoutValidationError[] = [];
  const title = trimMetadata(metadata.title);
  if (!title) {
    errors.push({ field: 'title', message: 'Title is required to move the file' });
  }
  if (!mainLibraryConfigured) {
    errors.push({
      field: 'mainLibraryPath',
      message: 'Configure a main library folder in Settings',
    });
  }
  const album = trimMetadata(metadata.album);
  if (album && (metadata.year == null || !Number.isInteger(metadata.year))) {
    errors.push({
      field: 'year',
      message: 'Year is required when an album is set',
    });
  }
  if (title) {
    const built = buildLibraryRelativeSegments({
      ...metadata,
      title,
    });
    if (!built) {
      errors.push({
        field: 'path',
        message: 'Metadata cannot build a valid library path',
      });
    } else if (segmentIsPlaylists(built)) {
      errors.push({
        field: 'path',
        message: 'Cannot move files into the Playlists folder',
      });
    }
  }
  return errors;
}

function segmentIsPlaylists(segments: string[]): boolean {
  return segments.some(
    (segment) => segment.replace(/\\/g, '/') === PLAYLISTS_FOLDER,
  );
}

/** Path segments relative to the main library root (no leading slash). */
export function buildLibraryRelativeSegments(
  metadata: LibraryLayoutMetadata,
): string[] | null {
  const title = trimMetadata(metadata.title);
  if (!title) {
    return null;
  }
  const artistFolder = artistFolderName(
    trimMetadata(metadata.albumArtist),
    trimMetadata(metadata.artist),
  );
  const albumFolder = albumFolderName(
    metadata.album,
    metadata.year,
  );
  if (!albumFolder) {
    return null;
  }
  const fileName = formatTrackFileName(
    title,
    metadata.trackNo,
    metadata.fileExtension,
  );
  if (!fileName || fileName === metadata.fileExtension) {
    return null;
  }
  if (isUnknownArtistFolder(artistFolder)) {
    return [UNKNOWN_ARTIST_FOLDER, albumFolder, fileName];
  }
  const letter = letterFolderForArtist(artistFolder);
  if (!letter) {
    return null;
  }
  return [letter, artistFolder, albumFolder, fileName];
}

export function buildLibraryRelativePath(
  metadata: LibraryLayoutMetadata,
): string | null {
  const segments = buildLibraryRelativeSegments(metadata);
  if (!segments) {
    return null;
  }
  return segments.join('/');
}

export function withConflictSuffix(
  absolutePath: string,
  suffixIndex: number,
): string {
  const directory = dirname(absolutePath);
  const base = basename(absolutePath);
  const ext = extname(base);
  const stem = base.slice(0, base.length - ext.length);
  const nextStem = suffixIndex <= 1 ? stem : `${stem} (${suffixIndex})`;
  return join(directory, `${nextStem}${ext}`);
}
