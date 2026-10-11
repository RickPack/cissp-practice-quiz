// Inline formatting for question text, without parsing any HTML: **bold**, and `code` when the track allows it.
import { emphasisRuns } from './core.js';

/** Split text into [{ text, strong, code }] runs. With code off (the CISSP track) this is exactly emphasisRuns. */
export function inlineRuns(text, { code = false } = {}) {
  const value = String(text);
  const plain = (s) => emphasisRuns(s).map((r) => ({ ...r, code: false }));
  const parts = value.split('`');
  // Code off, or an unpaired backtick: no code runs at all.
  if (!code || parts.length % 2 === 0) return plain(value);
  return parts.flatMap((part, i) => {
    if (!part) return [];
    return i % 2 ? [{ text: part, strong: false, code: true }] : plain(part);
  });
}
