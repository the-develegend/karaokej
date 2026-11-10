import { ApiError } from '../api';

const STACK_LINE = /^at\s+\S/;
const NAMED = /^could not (store|save) metadata\b/i;

/** Message shown in Edit metadata when a save does not stick. No stack traces. */
export function saveFailureMessage(err: unknown): string {
  const status = err instanceof ApiError ? err.status : undefined;
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const detail = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !STACK_LINE.test(line))
    .join(' — ');
  const text = detail || 'Unknown error';
  if (NAMED.test(text)) {
    if (status != null && !text.includes(`HTTP ${status}`)) {
      return `${text} (HTTP ${status})`;
    }
    return text;
  }
  const prefix =
    status != null
      ? `Could not save metadata (HTTP ${status})`
      : 'Could not save metadata';
  return `${prefix}: ${text}`;
}
