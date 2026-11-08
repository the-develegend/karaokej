import { Injectable } from '@nestjs/common';
import type { MetadataProviderContext } from './metadata-search.types';

/** Short sample fingerprint used only to validate API keys (invalid fingerprint, not invalid key). */
const TEST_FINGERPRINT = 'AQABj0mYdElO';
const TEST_DURATION = 123;

@Injectable()
export class AcoustIdMetadataClient {
  async test(
    context: MetadataProviderContext,
  ): Promise<{ ok: boolean; message: string }> {
    const apiKey = context.stored.acoustid.apiKey.trim();
    if (!apiKey) {
      return { ok: false, message: 'Save an API key first.' };
    }
    const params = new URLSearchParams({
      client: apiKey,
      duration: String(TEST_DURATION),
      fingerprint: TEST_FINGERPRINT,
      meta: 'recordings',
      format: 'json',
    });
    try {
      const response = await fetch(
        `https://api.acoustid.org/v2/lookup?${params.toString()}`,
      );
      if (!response.ok) {
        return { ok: false, message: `AcoustID returned ${response.status}` };
      }
      const data = (await response.json()) as {
        status?: string;
        error?: { message?: string; code?: number };
      };
      if (data.status === 'error') {
        const message = data.error?.message ?? 'Unknown AcoustID error';
        if (/invalid api key/i.test(message)) {
          return { ok: false, message };
        }
        if (/invalid fingerprint/i.test(message)) {
          return { ok: true, message: 'API key accepted.' };
        }
        return { ok: false, message };
      }
      return { ok: true, message: 'API key accepted.' };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
