import type { MetadataSearchQuery } from './metadata-search.types';

export function defaultQueryFromTags(input: {
  title: string;
  artist: string | null;
  album: string | null;
}): MetadataSearchQuery {
  const parts = [input.artist, input.title].filter(Boolean);
  const text =
    parts.length > 0
      ? parts.join(' ')
      : input.title || input.album || '';
  return {
    text: text.trim(),
    title: input.title.trim() || null,
    artist: input.artist,
    album: input.album,
  };
}

export function luceneEscape(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
