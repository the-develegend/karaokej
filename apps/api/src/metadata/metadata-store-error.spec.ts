import { describe, expect, it } from 'vitest';
import {
  describeMetadataStoreError,
  metadataStoreError,
} from './metadata-store-error';

describe('describeMetadataStoreError', () => {
  it('keeps the message and errno code and drops the stack', () => {
    const err = Object.assign(new Error('permission denied, open \'/music/a.mp3\''), {
      code: 'EACCES',
    });
    err.stack = "Error: permission denied\n    at writeFile (fs.js:1:1)\n    at save (metadata.ts:10:5)";

    expect(describeMetadataStoreError(err)).toBe(
      "EACCES: permission denied, open '/music/a.mp3'",
    );
  });

  it('includes the cause message without its stack', () => {
    const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    cause.stack = 'Error: permission denied\n    at open (fs.js:4:2)';
    const err = new Error(
      'Failed to update /music/a.mp3: the original content was restored\n    at rollback (safe-file-write.ts:20:3)',
      { cause },
    );

    expect(describeMetadataStoreError(err)).toBe(
      'Failed to update /music/a.mp3: the original content was restored — EACCES: permission denied',
    );
  });

  it('wraps storage failures for the client without a stack trace', () => {
    const err = new Error('disk full\n    at write (tags.ts:3:1)');
    const http = metadataStoreError(err);
    const body = http.getResponse();
    const message =
      typeof body === 'string'
        ? body
        : typeof body === 'object' && body && 'message' in body
          ? String((body as { message: unknown }).message)
          : '';

    expect(http.getStatus()).toBe(500);
    expect(message).toBe('Could not store metadata: disk full');
    expect(message).not.toContain('at write');
  });
});
