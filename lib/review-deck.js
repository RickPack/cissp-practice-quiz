// Spaced review deck (Leitner boxes). Pure: no DOM; storage and the clock are passed in.
// Stored in this browser only, as { [questionId]: { box, due, added } }: IDs, a box number, and dates. No question text.
import { mulberry32, seedFromString, shuffle, makePermutation } from './core.js';

export const DECK_KEY = 'cissp-diagnostic:review';

// Days until a card in box 1, 2, 3, 4 is due again. A correct answer in the last box graduates the card.
// To change the schedule, edit this list; cards in a box past the end of a shorter list are treated as the last box.
export const INTERVALS = [1, 3, 7, 14];

export const COMMUTE_CAP = 20;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Local calendar date of a Date, as YYYY-MM-DD. Uses the device's time zone, so a day starts at local midnight. */
export function localDate(d) {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isDate(s) {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
}

/** Calendar arithmetic on YYYY-MM-DD strings. Done in UTC, so daylight-saving changes never shift a date. */
export function addDays(ymd, n) {
  const m = DATE_RE.exec(ymd);
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n));
  return `${pad(t.getUTCFullYear(), 4)}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const intervalFor = (box) => INTERVALS[Math.min(box, INTERVALS.length) - 1];

/**
 * Keeps only well-formed cards for questions still in the bank. Anything else (corrupt JSON, hostile values,
 * IDs the bank no longer has) is dropped. If the clock went backwards, dates in the future are pulled back:
 * `added` to today, `due` to at most one interval from today.
 */
export function sanitizeDeck(raw, knownIds, today) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [id, e] of Object.entries(raw)) {
    if (!knownIds.has(id) || !e || typeof e !== 'object') continue;
    if (!Number.isInteger(e.box) || e.box < 1 || !isDate(e.due) || !isDate(e.added)) continue;
    const box = Math.min(e.box, INTERVALS.length);
    const latest = addDays(today, intervalFor(box));
    out[id] = { box, due: e.due > latest ? latest : e.due, added: e.added > today ? today : e.added };
  }
  return out;
}

export function loadDeck(storage, knownIds, today) {
  try {
    return sanitizeDeck(JSON.parse(storage.getItem(DECK_KEY) || 'null'), knownIds, today);
  } catch {
    return {};
  }
}

export function saveDeck(deck, storage) {
  try {
    storage.setItem(DECK_KEY, JSON.stringify(deck));
    return true;
  } catch {
    return false; // storage full or blocked: the deck lasts for this page view only
  }
}

export function clearDeck(storage) {
  try {
    storage.removeItem(DECK_KEY);
  } catch {
    // Nothing stored to clear.
  }
}

export const isDue = (card, today) => card.due <= today;

/** IDs due today or earlier: most overdue first, then lowest box, then by ID so the order is stable. */
export function dueIds(deck, today) {
  return Object.entries(deck)
    .filter(([, c]) => isDue(c, today))
    .sort(([a, x], [b, y]) => (x.due < y.due ? -1 : x.due > y.due ? 1 : x.box - y.box || (a < b ? -1 : 1)))
    .map(([id]) => id);
}

/**
 * Applies one result to the deck in place and returns what changed:
 * 'added', 'reset' (back to box 1), 'up' (next box), 'graduated' (removed), or 'none'.
 * outcome: 'missed' | 'correct' | 'open' (flagged and left unanswered) | 'skipped'.
 * A correct answer moves a card up only when it is due, so answering early never skips a step.
 */
export function recordResult(deck, id, outcome, today) {
  const card = Object.hasOwn(deck, id) ? deck[id] : null;
  if (outcome === 'missed') {
    deck[id] = { box: 1, due: addDays(today, intervalFor(1)), added: card ? card.added : today };
    return card ? 'reset' : 'added';
  }
  if (outcome === 'open') {
    if (card) return 'none';
    deck[id] = { box: 1, due: addDays(today, intervalFor(1)), added: today };
    return 'added';
  }
  if (outcome === 'correct' && card && isDue(card, today)) {
    if (card.box >= INTERVALS.length) {
      delete deck[id];
      return 'graduated';
    }
    deck[id] = { ...card, box: card.box + 1, due: addDays(today, intervalFor(card.box + 1)) };
    return 'up';
  }
  return 'none';
}

export const emptySummary = () => ({ added: 0, up: 0, graduated: 0, reset: 0 });

export function tallyChange(summary, change) {
  if (change in summary) summary[change] += 1;
  return summary;
}

/**
 * Updates the deck from a submitted session. results: [{ id, answered, correct, flagged }].
 * Missed questions are added (or reset), flagged unanswered ones are added, due cards answered correctly move up.
 */
export function applySession(deck, results, today) {
  const summary = emptySummary();
  for (const r of results) {
    const outcome = r.answered ? (r.correct ? 'correct' : 'missed') : r.flagged ? 'open' : 'skipped';
    tallyChange(summary, recordResult(deck, r.id, outcome, today));
  }
  return summary;
}

/** A session in the usual shape, built only from due cards (no sampler), most overdue first, then shuffled. */
export function createReviewSession(deck, today, { cap, seed, bankVersion, startedAt = new Date().toISOString() }) {
  const seedText = String(seed);
  const rng = mulberry32(seedFromString(seedText));
  const ids = shuffle(dueIds(deck, today).slice(0, Math.max(0, cap)), rng);
  return {
    schema: 1,
    seed: seedText,
    bankVersion,
    mode: 'review',
    focusDomains: [],
    items: ids.map((id) => ({ id, perm: makePermutation(rng) })),
    responses: {},
    flagged: {},
    current: 0,
    startedAt,
    submittedAt: null,
  };
}

/**
 * Commute queue: due cards first, then recently missed questions (the caller's list, then deck cards by newest),
 * then a random fill from the bank. `exclude` keeps out questions of an unfinished quiz session.
 */
export function commuteQueue({ deck, today, recentMissed = [], bankIds, rng, cap = COMMUTE_CAP, exclude = new Set() }) {
  const ids = [];
  const seen = new Set(exclude);
  const counts = { due: 0, recent: 0, random: 0 };
  const take = (list, kind) => {
    for (const id of list) {
      if (ids.length >= cap) return;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
      counts[kind] += 1;
    }
  };
  const known = new Set(bankIds);
  take(dueIds(deck, today), 'due');
  const newest = Object.entries(deck)
    .filter(([, c]) => !isDue(c, today))
    .sort(([a, x], [b, y]) => (x.added > y.added ? -1 : x.added < y.added ? 1 : a < b ? -1 : 1))
    .map(([id]) => id);
  take([...recentMissed.filter((id) => known.has(id)), ...newest], 'recent');
  if (ids.length < cap) take(shuffle(bankIds, rng), 'random');
  return { ids, counts };
}
