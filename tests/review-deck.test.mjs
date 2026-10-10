import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DECK_KEY, INTERVALS, localDate, isDate, addDays, sanitizeDeck, loadDeck, saveDeck, clearDeck,
  dueIds, recordResult, applySession, createReviewSession, commuteQueue,
} from '../lib/review-deck.js';
import { mulberry32, LETTERS } from '../lib/core.js';

// A zone with daylight saving, so the DST cases below are real on any machine that honours TZ.
process.env.TZ = 'America/New_York';

const store = (init = {}) => {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
};
const ids = (...list) => new Set(list);
const card = (box, due, added = '2026-01-01') => ({ box, due, added });

// ---------- Dates ----------

test('localDate uses the local calendar day, including right before and after midnight', () => {
  assert.equal(localDate(new Date(2026, 9, 10, 23, 59, 59)), '2026-10-10');
  assert.equal(localDate(new Date(2026, 9, 11, 0, 0, 1)), '2026-10-11');
  assert.equal(localDate(new Date(2026, 0, 5, 12)), '2026-01-05');
});

test('addDays is calendar arithmetic: month and year ends, leap days', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('daylight-saving changes never shift a due date', () => {
  // US clocks go forward on 2026-03-08 and back on 2026-11-01.
  assert.equal(addDays('2026-03-07', 1), '2026-03-08');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  // Just after midnight on the short and the long day is still that day locally.
  assert.equal(localDate(new Date(2026, 2, 8, 0, 30)), '2026-03-08');
  assert.equal(localDate(new Date(2026, 2, 8, 23, 30)), '2026-03-08');
  assert.equal(localDate(new Date(2026, 10, 1, 23, 30)), '2026-11-01');
  // 24 hours after 00:30 on the short day lands on the next day at 01:30, and the date still advances by one.
  const before = new Date(2026, 2, 8, 0, 30);
  const after = new Date(before.getTime() + 24 * 3600 * 1000);
  assert.equal(localDate(after), '2026-03-09');
});

test('isDate rejects anything that is not a real YYYY-MM-DD date', () => {
  assert.equal(isDate('2026-10-10'), true);
  for (const bad of ['2026-02-30', '2026-13-01', '26-10-10', '2026-10-10T00:00', '', null, 20261010, {}, '2026-1-1']) {
    assert.equal(isDate(bad), false, String(bad));
  }
});

// ---------- Schedule ----------

test('the schedule is boxes at 1, 3, 7 and 14 days', () => {
  assert.deepEqual(INTERVALS, [1, 3, 7, 14]);
});

test('a missed question enters box 1, due tomorrow', () => {
  const deck = {};
  assert.equal(recordResult(deck, 'D1-0001', 'missed', '2026-10-10'), 'added');
  assert.deepEqual(deck['D1-0001'], { box: 1, due: '2026-10-11', added: '2026-10-10' });
});

test('correct answers walk a card through every box, then graduate it', () => {
  const deck = {};
  let today = '2026-10-10';
  recordResult(deck, 'q', 'missed', today);
  const seen = [];
  for (let i = 0; i < INTERVALS.length; i++) {
    today = deck.q.due;
    const change = recordResult(deck, 'q', 'correct', today);
    seen.push(change);
    if (change === 'up') assert.equal(deck.q.due, addDays(today, INTERVALS[deck.q.box - 1]));
  }
  assert.deepEqual(seen, ['up', 'up', 'up', 'graduated']);
  assert.equal('q' in deck, false);
});

test('box 1 -> box 2 is due in 3 days, box 2 -> 3 in 7, box 3 -> 4 in 14', () => {
  const deck = { q: card(1, '2026-10-10') };
  recordResult(deck, 'q', 'correct', '2026-10-10');
  assert.deepEqual(deck.q, { box: 2, due: '2026-10-13', added: '2026-01-01' });
  recordResult(deck, 'q', 'correct', '2026-10-13');
  assert.equal(deck.q.due, '2026-10-20');
  recordResult(deck, 'q', 'correct', '2026-10-20');
  assert.deepEqual(deck.q, { box: 4, due: '2026-11-03', added: '2026-01-01' });
});

test('a miss resets any box to box 1 and keeps the original added date', () => {
  const deck = { q: card(3, '2026-10-10', '2026-09-01') };
  assert.equal(recordResult(deck, 'q', 'missed', '2026-10-10'), 'reset');
  assert.deepEqual(deck.q, { box: 1, due: '2026-10-11', added: '2026-09-01' });
});

test('a correct answer before the card is due changes nothing', () => {
  const deck = { q: card(2, '2026-10-12') };
  assert.equal(recordResult(deck, 'q', 'correct', '2026-10-11'), 'none');
  assert.deepEqual(deck.q, card(2, '2026-10-12'));
});

test('a correct answer on a question not in the deck, and a skip, change nothing', () => {
  const deck = { q: card(1, '2026-10-01') };
  assert.equal(recordResult(deck, 'other', 'correct', '2026-10-10'), 'none');
  assert.equal(recordResult(deck, 'q', 'skipped', '2026-10-10'), 'none');
  assert.deepEqual(Object.keys(deck), ['q']);
});

test('day boundary: a card due tomorrow becomes due exactly at local midnight', () => {
  const deck = {};
  recordResult(deck, 'q', 'missed', localDate(new Date(2026, 9, 10, 23, 58)));
  assert.deepEqual(dueIds(deck, localDate(new Date(2026, 9, 10, 23, 59, 59))), []);
  assert.deepEqual(dueIds(deck, localDate(new Date(2026, 9, 11, 0, 0, 0))), ['q']);
});

test('dueIds: most overdue first, then lowest box, then ID', () => {
  const deck = {
    b: card(2, '2026-10-09'),
    a: card(1, '2026-10-09'),
    c: card(1, '2026-10-01'),
    later: card(1, '2026-10-11'),
    z: card(1, '2026-10-10'),
  };
  assert.deepEqual(dueIds(deck, '2026-10-10'), ['c', 'a', 'b', 'z']);
});

// ---------- Session updates ----------

test('a submitted session adds missed and flagged-unanswered questions, and moves due cards up', () => {
  const deck = { due: card(1, '2026-10-09'), notdue: card(2, '2026-10-20'), last: card(4, '2026-10-10'), relapse: card(3, '2026-10-30') };
  const summary = applySession(deck, [
    { id: 'miss', answered: true, correct: false, flagged: false },
    { id: 'flagmiss', answered: true, correct: false, flagged: true },
    { id: 'flagopen', answered: false, correct: false, flagged: true },
    { id: 'open', answered: false, correct: false, flagged: false },
    { id: 'flagright', answered: true, correct: true, flagged: true },
    { id: 'due', answered: true, correct: true, flagged: false },
    { id: 'notdue', answered: true, correct: true, flagged: false },
    { id: 'last', answered: true, correct: true, flagged: false },
    { id: 'relapse', answered: true, correct: false, flagged: false },
  ], '2026-10-10');
  assert.deepEqual(summary, { added: 3, up: 1, graduated: 1, reset: 1 });
  assert.deepEqual(Object.keys(deck).sort(), ['due', 'flagmiss', 'flagopen', 'miss', 'notdue', 'relapse']);
  assert.equal(deck.due.box, 2);
  assert.equal(deck.notdue.box, 2);
  assert.equal(deck.relapse.box, 1);
});

test('a flagged unanswered question already in the deck keeps its place', () => {
  const deck = { q: card(3, '2026-10-15') };
  assert.deepEqual(applySession(deck, [{ id: 'q', answered: false, correct: false, flagged: true }], '2026-10-10'), { added: 0, up: 0, graduated: 0, reset: 0 });
  assert.deepEqual(deck.q, card(3, '2026-10-15'));
});

// ---------- Storage and sanitising ----------

test('save and load round-trip under one key', () => {
  const s = store();
  const deck = { 'D1-0001': card(2, '2026-10-12', '2026-10-01') };
  assert.equal(saveDeck(deck, s), true);
  assert.ok(DECK_KEY in s.data);
  assert.deepEqual(loadDeck(s, ids('D1-0001'), '2026-10-10'), deck);
  clearDeck(s);
  assert.deepEqual(loadDeck(s, ids('D1-0001'), '2026-10-10'), {});
});

test('stored data holds only IDs, box numbers, and dates', () => {
  const s = store();
  saveDeck({ 'D1-0001': card(1, '2026-10-11', '2026-10-10') }, s);
  assert.equal(s.data[DECK_KEY], '{"D1-0001":{"box":1,"due":"2026-10-11","added":"2026-10-10"}}');
});

test('unknown IDs (the bank changed) are dropped on load', () => {
  const s = store({ [DECK_KEY]: JSON.stringify({ keep: card(1, '2026-10-11'), gone: card(1, '2026-10-11') }) });
  assert.deepEqual(Object.keys(loadDeck(s, ids('keep'), '2026-10-10')), ['keep']);
});

test('corrupt or hostile stored data falls back to an empty deck or drops the bad cards', () => {
  const today = '2026-10-10';
  const known = ids('a', 'b', 'c', 'd', 'e', 'f', '__proto__', 'constructor');
  assert.deepEqual(loadDeck(store({ [DECK_KEY]: '{bad' }), known, today), {});
  assert.deepEqual(loadDeck(store({ [DECK_KEY]: '[1,2]' }), known, today), {});
  assert.deepEqual(loadDeck(store({ [DECK_KEY]: '"text"' }), known, today), {});
  assert.deepEqual(loadDeck({ getItem() { throw new Error('blocked'); } }, known, today), {});
  const hostile = JSON.stringify({
    a: { box: 0, due: today, added: today },
    b: { box: '2', due: today, added: today },
    c: { box: 1.5, due: today, added: today },
    d: { box: 1, due: '<script>', added: today },
    e: { box: 1, due: today },
    f: null,
  });
  assert.deepEqual(loadDeck(store({ [DECK_KEY]: hostile }), known, today), {});
  const proto = '{"__proto__":{"box":1,"due":"2026-10-10","added":"2026-10-10","polluted":true}}';
  loadDeck(store({ [DECK_KEY]: proto }), known, today);
  assert.equal({}.polluted, undefined, 'no prototype pollution');
  assert.doesNotThrow(() => saveDeck({}, { setItem() { throw new Error('full'); } }));
  assert.equal(saveDeck({}, { setItem() { throw new Error('full'); } }), false);
  assert.doesNotThrow(() => clearDeck({ removeItem() { throw new Error('blocked'); } }));
});

test('extra fields are not kept, and a box past the last interval is treated as the last box', () => {
  const out = sanitizeDeck({ a: { box: 9, due: '2026-10-11', added: '2026-10-01', text: 'question text' } }, ids('a'), '2026-10-10');
  assert.deepEqual(out, { a: { box: 4, due: '2026-10-11', added: '2026-10-01' } });
});

test('clock moved backwards: future dates are pulled back so cards are not stranded', () => {
  // The cards were written while the clock read 2027; it now reads 2026-10-10.
  const out = sanitizeDeck({
    a: { box: 1, due: '2027-06-02', added: '2027-06-01' },
    b: { box: 4, due: '2027-06-15', added: '2027-05-01' },
    c: { box: 2, due: '2026-10-12', added: '2026-10-09' },
  }, ids('a', 'b', 'c'), '2026-10-10');
  assert.deepEqual(out.a, { box: 1, due: '2026-10-11', added: '2026-10-10' });
  assert.deepEqual(out.b, { box: 4, due: '2026-10-24', added: '2026-10-10' });
  assert.deepEqual(out.c, { box: 2, due: '2026-10-12', added: '2026-10-09' }, 'normal cards untouched');
});

// ---------- Review sessions ----------

test('a review session uses the usual session shape with mode "review" and only due questions', () => {
  const deck = { a: card(1, '2026-10-09'), b: card(2, '2026-10-10'), c: card(1, '2026-10-11') };
  const s = createReviewSession(deck, '2026-10-10', { cap: 100, seed: 'x', bankVersion: '1.0', startedAt: '2026-10-10T20:00:00.000Z' });
  assert.equal(s.schema, 1);
  assert.equal(s.mode, 'review');
  assert.deepEqual(s.items.map((it) => it.id).sort(), ['a', 'b']);
  for (const it of s.items) assert.deepEqual([...it.perm].sort(), LETTERS);
  assert.deepEqual(s.responses, {});
  assert.deepEqual(s.flagged, {});
  assert.equal(s.submittedAt, null);
  assert.equal(s.startedAt, '2026-10-10T20:00:00.000Z');
  assert.deepEqual(s.focusDomains, []);
});

test('a review session is capped, keeps the most overdue cards, and is reproducible from its seed', () => {
  const deck = {};
  for (let i = 0; i < 150; i++) deck[`q${String(i).padStart(3, '0')}`] = card(1, addDays('2026-06-01', i % 100));
  const a = createReviewSession(deck, '2026-10-10', { cap: 100, seed: 's', bankVersion: 't' });
  const b = createReviewSession(deck, '2026-10-10', { cap: 100, seed: 's', bankVersion: 't' });
  assert.equal(a.items.length, 100);
  assert.deepEqual(a.items, b.items);
  const chosen = new Set(a.items.map((it) => it.id));
  for (const id of dueIds(deck, '2026-10-10').slice(0, 100)) assert.ok(chosen.has(id));
});

// ---------- Commute queue ----------

test('commute queue: due cards first, then recently missed, then random, capped at 20', () => {
  const bankIds = Array.from({ length: 60 }, (_, i) => `q${i}`);
  const deck = { q1: card(1, '2026-10-09'), q2: card(2, '2026-10-10'), q3: card(1, '2026-10-12', '2026-10-09'), q4: card(1, '2026-10-12', '2026-10-01') };
  const { ids: out, counts } = commuteQueue({ deck, today: '2026-10-10', recentMissed: ['q9', 'q1', 'gone'], bankIds, rng: mulberry32(1) });
  assert.equal(out.length, 20);
  assert.deepEqual(out.slice(0, 2), ['q1', 'q2'], 'due first');
  assert.deepEqual(out.slice(2, 5), ['q9', 'q3', 'q4'], 'then recent misses, then newer deck cards');
  assert.deepEqual(counts, { due: 2, recent: 3, random: 15 });
  assert.equal(new Set(out).size, 20, 'no repeats');
  assert.ok(!out.includes('gone'));
});

test('commute queue leaves out questions of an unfinished quiz session and copes with a small bank', () => {
  const { ids: out } = commuteQueue({ deck: {}, today: '2026-10-10', bankIds: ['a', 'b', 'c'], rng: mulberry32(2), exclude: new Set(['b']) });
  assert.deepEqual(out.sort(), ['a', 'c']);
});
