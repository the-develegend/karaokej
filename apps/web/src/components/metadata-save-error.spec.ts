import { describe, expect, it } from 'vitest';
import { ApiError } from '../api';
import { saveFailureMessage } from './metadata-save-error';

describe('saveFailureMessage', () => {
  it('surfaces the API reason and status without a stack', () => {
    const err = new ApiError(
      "Could not store metadata: EACCES: permission denied, open '/music/a.mp3'\n    at writeFile (fs.js:1:1)",
      500,
      null,
    );

    expect(saveFailureMessage(err)).toBe(
      "Could not store metadata: EACCES: permission denied, open '/music/a.mp3' (HTTP 500)",
    );
  });

  it('names network failures that never reached the API', () => {
    expect(saveFailureMessage(new TypeError('Failed to fetch'))).toBe(
      'Could not save metadata: Failed to fetch',
    );
  });
});
