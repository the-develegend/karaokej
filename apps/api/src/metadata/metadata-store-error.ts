import { InternalServerErrorException } from '@nestjs/common';

const STACK_LINE = /^at\s+\S/;
const MAX_DETAIL_LENGTH = 600;

/**
 * Client-facing reason for a failed metadata write. Includes the error name,
 * errno code, and message (and the same for `cause`), and drops stack frames.
 */
export function describeMetadataStoreError(err: unknown, depth = 0): string {
  if (depth > 4 || err == null) {
    return 'Unknown error';
  }
  if (typeof err === 'string') {
    return clamp(withoutStack(err) || 'Unknown error');
  }
  if (!(err instanceof Error)) {
    return 'Unknown error';
  }

  const code = errnoCode(err);
  const message = withoutStack(err.message);
  let text = message;
  if (code && !message.includes(code)) {
    text = message ? `${code}: ${message}` : code;
  }
  if (!text) {
    text = err.name && err.name !== 'Error' ? err.name : 'Unknown error';
  } else if (
    err.name &&
    err.name !== 'Error' &&
    !text.toLowerCase().includes(err.name.toLowerCase())
  ) {
    text = `${err.name}: ${text}`;
  }

  const cause = err.cause;
  if (cause != null && cause !== err) {
    const nested = describeMetadataStoreError(cause, depth + 1);
    if (nested !== 'Unknown error' && !text.includes(nested)) {
      text = `${text} — ${nested}`;
    }
  }
  return clamp(text);
}

export function metadataStoreError(err: unknown): InternalServerErrorException {
  return new InternalServerErrorException(
    `Could not store metadata: ${describeMetadataStoreError(err)}`,
  );
}

function withoutStack(message: string): string {
  return message
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !STACK_LINE.test(line))
    .join(' — ');
}

function errnoCode(err: Error): string | undefined {
  if ('code' in err && typeof err.code === 'string' && err.code.length > 0) {
    return err.code;
  }
  return undefined;
}

function clamp(text: string): string {
  if (text.length <= MAX_DETAIL_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_DETAIL_LENGTH - 1)}…`;
}
