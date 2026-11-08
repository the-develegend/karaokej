import type {
  MetadataSearchHitDto,
  MetadataSearchProviderId,
} from '@karaokej/shared';
import type { StoredMetadataProviders } from '../settings/metadata-providers-settings';

export interface MetadataSearchQuery {
  text: string;
  title: string | null;
  artist: string | null;
  album: string | null;
}

export interface MetadataProviderContext {
  stored: StoredMetadataProviders;
}

export interface MetadataProviderClient {
  id: MetadataSearchProviderId;
  label: string;
  search(
    query: MetadataSearchQuery,
    context: MetadataProviderContext,
  ): Promise<MetadataSearchHitDto[]>;
  test(context: MetadataProviderContext): Promise<{ ok: boolean; message: string }>;
}
