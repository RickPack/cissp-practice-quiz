import { PRONUNCIATIONS } from './pronunciations.js';

export const MAX_CHUNK = 180;
export const OPTION_PAUSE_MS = 500;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Drop the **emphasis** markers the bank uses; the speaker should not read asterisks.
export function plainText(text) {
  return String(text).replace(/\*\*(.+?)\*\*/g, '$1');
}

export function applyPronunciations(text, map = PRONUNCIATIONS) {
  let out = text;
  for (const [written, spoken] of map) {
    out = out.replace(new RegExp(`(?<![A-Za-z0-9])${escapeRe(written)}(?![A-Za-z0-9])`, 'g'), spoken);
  }
  return out;
}

// Split into sentence-sized pieces no longer than max characters.
// Chrome stops long utterances after roughly 15 seconds, so each piece is spoken on its own.
export function chunkText(text, max = MAX_CHUNK) {
  const sentences = text.split(/(?<=[.!?;:])\s+/).map((s) => s.trim()).filter(Boolean);
  const pieces = [];
  for (const s of sentences) {
    if (s.length <= max) {
      pieces.push(s);
      continue;
    }
    let rest = s;
    while (rest.length > max) {
      let cut = rest.lastIndexOf(', ', max);
      if (cut < max / 2) cut = rest.lastIndexOf(' ', max);
      const end = cut <= 0 ? max : cut + 1;
      pieces.push(rest.slice(0, end).trim());
      rest = rest.slice(end).trim();
    }
    if (rest) pieces.push(rest);
  }
  // Merge short neighbours so speech does not stutter.
  const merged = [];
  for (const p of pieces) {
    const last = merged[merged.length - 1];
    if (last && last.length + 1 + p.length <= max) merged[merged.length - 1] = `${last} ${p}`;
    else merged.push(p);
  }
  return merged;
}

function toChunks(parts) {
  const out = [];
  for (const { text, pause = 0 } of parts) {
    const pieces = chunkText(applyPronunciations(plainText(text)));
    pieces.forEach((piece, i) => out.push({ text: piece, pause: i === pieces.length - 1 ? pause : 0 }));
  }
  return out;
}

// Quiz reading: number, stem, then each option in the order and letters shown on screen.
// It takes only the stem and option text, so nothing about the answer can be spoken.
export function questionChunks({ number, stem, options }) {
  const parts = [{ text: `Question ${number}.`, pause: 300 }, { text: stem, pause: OPTION_PAUSE_MS }];
  for (const o of options) parts.push({ text: `Option ${o.letter}. ${o.text}`, pause: OPTION_PAUSE_MS });
  return toChunks(parts);
}

// Spoken only when the user has turned on immediate feedback. The quiz itself never calls this.
export function feedbackChunks({ isCorrect, correct }) {
  return [{ text: isCorrect ? 'Correct.' : `Not correct. The correct answer is ${correct}.`, pause: 0 }];
}

// Report-only reading of an explanation.
export function explanationChunks({ correct, explanation }) {
  return toChunks([
    { text: `The correct answer is ${correct}.`, pause: 300 },
    { text: explanation, pause: 0 },
  ]);
}
