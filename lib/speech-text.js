import { PRONUNCIATIONS } from './pronunciations.js';

export const MAX_CHUNK = 180;
export const OPTION_PAUSE_MS = 500;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Drop the **emphasis** and `code` markers the banks use; the speaker should not read asterisks or backticks.
export function plainText(text) {
  return String(text).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
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

// A question with a code block: code read aloud is noise, so read the stem and point to the screen.
export const CODE_NOTICE = 'This question has code. Read the code and the options on screen, then answer.';

export function codeQuestionChunks({ number, stem }) {
  return toChunks([
    { text: `Question ${number}.`, pause: 300 },
    { text: stem, pause: OPTION_PAUSE_MS },
    { text: CODE_NOTICE, pause: 0 },
  ]);
}

// Spoken only when the user has turned on immediate feedback. The quiz itself never calls this.
export function feedbackChunks({ isCorrect, correct, explanation = '' }) {
  const parts = [
    { text: isCorrect ? 'Correct.' : 'Not correct.', pause: 300 },
    { text: `The correct answer is ${correct}.`, pause: 300 },
  ];
  if (explanation) parts.push({ text: explanation, pause: 0 });
  return toChunks(parts);
}

// Commute mode: nothing was answered, so say so, then reveal the answer as feedback does.
export function skippedChunks({ correct, explanation = '' }) {
  const parts = [
    { text: 'Skipped.', pause: 300 },
    { text: `The correct answer is ${correct}.`, pause: 300 },
  ];
  if (explanation) parts.push({ text: explanation, pause: 0 });
  return toChunks(parts);
}

// A plain line, chunked and with pronunciations applied.
export function lineChunks(text) {
  return toChunks([{ text, pause: 0 }]);
}

// Report-only reading of an explanation.
export function explanationChunks({ correct, explanation }) {
  return toChunks([
    { text: `The correct answer is ${correct}.`, pause: 300 },
    { text: explanation, pause: 0 },
  ]);
}
