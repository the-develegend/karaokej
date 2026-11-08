import { open, readFile } from 'node:fs/promises';
import NodeID3 from 'node-id3';
import {
  hasMpegFrameSync,
  padId3Tag,
  readId3Region,
  withReservedTagPadding,
} from './id3-region';
import { safePatchRegion, safeReplaceWithBuffer } from './safe-file-write';
import type { EditableTrackMetadata } from '../metadata/metadata-fields';
import { readMoodValues, writeMoodValues } from './id3-mood';
import { internalToPopm, POPM_EMAIL } from './rating-scale';

function musicBrainzUserDefined(
  metadata: EditableTrackMetadata,
): NonNullable<NodeID3.Tags['userDefinedText']> {
  const items: NonNullable<NodeID3.Tags['userDefinedText']> = [];
  if (metadata.musicbrainzArtistId) {
    items.push({
      description: 'MusicBrainz Artist Id',
      value: metadata.musicbrainzArtistId,
    });
  }
  if (metadata.musicbrainzRecordingId) {
    items.push({
      description: 'MusicBrainz Track Id',
      value: metadata.musicbrainzRecordingId,
    });
  }
  if (metadata.musicbrainzReleaseId) {
    items.push({
      description: 'MusicBrainz Album Id',
      value: metadata.musicbrainzReleaseId,
    });
  }
  return items;
}

function existingUserDefinedTags(
  existing: NodeID3.Tags,
): NonNullable<NodeID3.Tags['userDefinedText']> {
  const raw = existing.userDefinedText;
  if (!raw) {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(
    (
      entry,
    ): entry is { description: string; value: string } =>
      entry != null &&
      typeof entry === 'object' &&
      typeof entry.description === 'string' &&
      typeof entry.value === 'string',
  );
}

function mp3TagPayload(
  metadata: EditableTrackMetadata,
  existing: NodeID3.Tags,
  existingCounter: number,
): NodeID3.Tags {
  const nextMb = musicBrainzUserDefined(metadata);
  const payload: NodeID3.Tags = {
    title: metadata.title,
    artist: metadata.artist ?? undefined,
    album: metadata.album ?? undefined,
    performerInfo: metadata.albumArtist ?? undefined,
    trackNumber:
      metadata.trackNo != null ? String(metadata.trackNo) : undefined,
    year: metadata.year != null ? String(metadata.year) : undefined,
    genre: metadata.genres.length > 0 ? metadata.genres.join(';') : undefined,
    popularimeter: {
      email: POPM_EMAIL,
      rating: internalToPopm(metadata.rating),
      counter: existingCounter,
    },
  };
  if (metadata.isrc) {
    payload.ISRC = metadata.isrc;
  }
  if (nextMb.length > 0) {
    const preservedUserDefined = existingUserDefinedTags(existing).filter(
      (entry) => {
        const desc = entry.description.toLowerCase();
        return (
          !desc.includes('musicbrainz artist') &&
          !desc.includes('musicbrainz track') &&
          !desc.includes('musicbrainz album')
        );
      },
    );
    payload.userDefinedText = [...preservedUserDefined, ...nextMb];
  }
  return payload;
}

/**
 * Confirms the tag area still declares `tagBytes` and that the first audio frame
 * begins exactly where it did, which is what keeps in-flight range requests valid.
 */
function verifyTagArea(tagBytes: number): (path: string) => Promise<void> {
  return async (path: string) => {
    const handle = await open(path, 'r');
    try {
      const head = Buffer.alloc(tagBytes + 2);
      const { bytesRead } = await handle.read(head, 0, head.length, 0);
      const region = readId3Region(head.subarray(0, bytesRead));
      if (!region || region.totalBytes !== tagBytes) {
        throw new Error(`${path} no longer declares a ${tagBytes} byte ID3v2 tag`);
      }
      if (bytesRead > tagBytes && !hasMpegFrameSync(head, tagBytes)) {
        throw new Error(`${path} has no MPEG frame at offset ${tagBytes}`);
      }
    } finally {
      await handle.close();
    }
  };
}

async function applyMp3Tags(
  absolutePath: string,
  buildTags: (existing: NodeID3.Tags) => NodeID3.Tags,
  moods?: string[],
): Promise<void> {
  const original = await readFile(absolutePath);
  const updatedRaw = NodeID3.update(buildTags(NodeID3.read(original)), original);
  if (updatedRaw instanceof Error) {
    throw updatedRaw;
  }
  const nextMoods = moods ?? readMoodValues(original);
  let tagged: Buffer = updatedRaw;
  if (!readId3Region(tagged) && nextMoods.length > 0) {
    const seeded = NodeID3.update({ mood: nextMoods[0] }, tagged);
    if (seeded instanceof Error) {
      throw seeded;
    }
    tagged = seeded;
  }
  const updated = writeMoodValues(tagged, nextMoods);

  const existing = readId3Region(original);
  const next = readId3Region(updated);

  // The audio frames are identical in both buffers, so as long as the new tag fits
  // the existing tag area we only have to rewrite that area. Nothing moves, and a
  // client streaming the file keeps reading valid audio at unchanged offsets.
  if (existing && next && next.totalBytes <= existing.totalBytes) {
    const padded = padId3Tag(
      updated.subarray(0, next.totalBytes),
      existing.totalBytes,
    );
    if (padded) {
      await safePatchRegion(absolutePath, padded, 0, {
        verify: verifyTagArea(existing.totalBytes),
      });
      return;
    }
  }

  const grown = withReservedTagPadding(updated);
  const grownRegion = readId3Region(grown);
  await safeReplaceWithBuffer(absolutePath, grown, {
    verify: grownRegion ? verifyTagArea(grownRegion.totalBytes) : undefined,
  });
}

export async function writeMp3Metadata(
  absolutePath: string,
  metadata: EditableTrackMetadata,
): Promise<void> {
  await applyMp3Tags(absolutePath, (existing) =>
    mp3TagPayload(metadata, existing, existing.popularimeter?.counter ?? 0),
  );
}

export async function writeMp3Moods(
  absolutePath: string,
  values: string[],
): Promise<void> {
  await applyMp3Tags(absolutePath, () => ({}), values);
}

export async function writeMp3Rating(
  absolutePath: string,
  rating: number,
): Promise<void> {
  await applyMp3Tags(absolutePath, (existing) => ({
    popularimeter: {
      email: POPM_EMAIL,
      rating: internalToPopm(rating),
      counter: existing.popularimeter?.counter ?? 0,
    },
  }));
}
