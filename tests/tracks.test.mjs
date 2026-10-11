import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TRACKS, TRACK_KEY, DEFAULT_TRACK, sanitizeTrack, loadTrack, saveTrack, trackKeys, unitLabel } from '../lib/tracks.js';
import { inlineRuns } from '../lib/rich-text.js';
import { emphasisRuns, createSession, scoreSession, canSubmit, maxSessionLength, QUESTION_TYPES, LETTERS } from '../lib/core.js';
import { plainText, codeQuestionChunks, CODE_NOTICE } from '../lib/speech-text.js';
import { DECK_KEY, loadDeck, saveDeck, clearDeck, commuteQueue } from '../lib/review-deck.js';
import { loadJSON } from './fixtures.mjs';
import { mulberry32 } from '../lib/core.js';

const store = (init = {}) => {
  const data = { ...init };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
};

// ---------- Tracks ----------

test('the CISSP track keeps the storage keys of earlier versions, so saved sessions and decks carry over', () => {
  assert.deepEqual(trackKeys('cissp'), { session: 'cissp-diagnostic:session', review: DECK_KEY });
  assert.equal(TRACKS.cissp.dataDir, 'data');
  assert.equal(DEFAULT_TRACK, 'cissp');
});

test('each track has its own session and deck keys', () => {
  const a = trackKeys('cissp');
  const b = trackKeys('python');
  assert.notEqual(a.session, b.session);
  assert.notEqual(a.review, b.review);
  assert.equal(TRACKS.python.dataDir, 'data-python');
});

test('track choice: only known IDs are kept; storage failures fall back to CISSP', () => {
  assert.equal(sanitizeTrack('python'), 'python');
  for (const bad of ['', 'PYTHON', '__proto__', 'constructor', null, 7, {}]) assert.equal(sanitizeTrack(bad), 'cissp', String(bad));
  const s = store();
  saveTrack('python', s);
  assert.equal(s.data[TRACK_KEY], 'python');
  assert.equal(loadTrack(s), 'python');
  saveTrack('<script>', s);
  assert.equal(s.data[TRACK_KEY], 'cissp', 'a hostile value is never stored');
  assert.equal(loadTrack(store({ [TRACK_KEY]: 'evil' })), 'cissp');
  assert.equal(loadTrack({ getItem() { throw new Error('blocked'); } }), 'cissp');
  assert.doesNotThrow(() => saveTrack('python', { setItem() { throw new Error('full'); } }));
});

test('unit labels follow the track', () => {
  assert.equal(unitLabel('cissp', 3, 'Security Architecture and Engineering'), 'D3 Security Architecture and Engineering');
  assert.equal(unitLabel('python', 2, 'Regular expressions and formatting'), 'T2 Regular expressions and formatting');
});

test('track question types are ones the scorer knows', () => {
  for (const t of Object.values(TRACKS)) for (const k of t.types) assert.ok(QUESTION_TYPES.includes(k), k);
});

// ---------- Review decks per track ----------

test('decks under different keys never touch each other', () => {
  const s = store();
  const day = '2026-10-10';
  saveDeck({ 'D1-0001': { box: 1, due: '2026-10-11', added: day } }, s);
  saveDeck({ 'P1-0001': { box: 2, due: '2026-10-13', added: day } }, s, trackKeys('python').review);
  assert.deepEqual(Object.keys(loadDeck(s, new Set(['D1-0001']), day)), ['D1-0001']);
  assert.deepEqual(Object.keys(loadDeck(s, new Set(['P1-0001']), day, trackKeys('python').review)), ['P1-0001']);
  // Loading the CISSP deck with only Python IDs known would drop its cards, which is why the keys differ.
  clearDeck(s, trackKeys('python').review);
  assert.ok(DECK_KEY in s.data);
  assert.ok(!(trackKeys('python').review in s.data));
});

test('commute queue only uses IDs from the given pool, even for due cards', () => {
  const deck = { coded: { box: 1, due: '2026-10-01', added: '2026-09-30' }, spoken: { box: 1, due: '2026-10-01', added: '2026-09-30' } };
  const { ids, counts } = commuteQueue({ deck, today: '2026-10-10', recentMissed: ['coded'], bankIds: ['spoken', 'other'], rng: mulberry32(3) });
  assert.ok(!ids.includes('coded'));
  assert.deepEqual(ids.slice(0, 1), ['spoken']);
  assert.equal(counts.due, 1);
});

// ---------- Inline code ----------

test('with code off, inline runs are exactly the emphasis runs (CISSP rendering unchanged)', () => {
  for (const text of ['Which is **NOT** a control?', 'Plain text', 'Has `backticks` but CISSP shows them as typed']) {
    assert.deepEqual(inlineRuns(text).map(({ text: t, strong }) => ({ text: t, strong })), emphasisRuns(text));
    assert.ok(inlineRuns(text).every((r) => r.code === false));
  }
});

test('with code on, backtick pairs become code runs and nothing is parsed as HTML', () => {
  assert.deepEqual(inlineRuns('What does `Counter()` return for **missing** keys?', { code: true }), [
    { text: 'What does ', strong: false, code: false },
    { text: 'Counter()', strong: false, code: true },
    { text: ' return for ', strong: false, code: false },
    { text: 'missing', strong: true, code: false },
    { text: ' keys?', strong: false, code: false },
  ]);
  assert.deepEqual(inlineRuns('`<img src=x onerror=alert(1)>`', { code: true }), [{ text: '<img src=x onerror=alert(1)>', strong: false, code: true }]);
  assert.ok(inlineRuns('one ` lonely backtick', { code: true }).every((r) => !r.code), 'an unpaired backtick stays plain text');
  assert.deepEqual(inlineRuns('`{}`', { code: true }), [{ text: '{}', strong: false, code: true }]);
});

// ---------- Speech ----------

test('speech never reads backticks, and a code question is not read option by option', () => {
  assert.equal(plainText('Call `tokenize()` on **this**'), 'Call tokenize() on this');
  const texts = codeQuestionChunks({ number: 4, stem: 'What does `allocate()` print?' }).map((c) => c.text).join(' ');
  assert.match(texts, /^Question 4\./);
  assert.ok(texts.includes(CODE_NOTICE));
  assert.ok(!texts.includes('`'));
  assert.ok(!/Option [A-D]/.test(texts));
});

// ---------- The Python bank ----------

const pyManifest = loadJSON('data-python/manifest.json');
const pyTaxonomy = loadJSON('data-python/taxonomy.json');
const pyBank = pyManifest.batches.flatMap((b) => loadJSON(`data-python/${b.file}`));

test('the Python bank loads and supports a full session with the unchanged sampler and scorer', () => {
  assert.ok(pyBank.length >= 20);
  assert.equal(new Set(pyBank.map((q) => q.id)).size, pyBank.length);
  const lookup = new Map(pyBank.map((q) => [q.id, q]));
  const length = maxSessionLength(pyBank.length);
  const s = createSession(pyBank, pyTaxonomy, { length, seed: 'py', bankVersion: pyManifest.bank_version });
  assert.equal(s.items.length, length);
  s.items.forEach((it) => { s.responses[it.id] = lookup.get(it.id).answer; });
  assert.ok(canSubmit(s));
  const r = scoreSession(s, lookup, pyTaxonomy);
  assert.equal(r.overall.pct, 1);
  assert.equal(r.byType.managerial_best_first_most.n, 0);
});

test('every Python question has the shape the app expects, and every code question is a verified one', () => {
  for (const q of pyBank) {
    assert.match(q.id, /^P[1-6]-\d{4}$/);
    assert.ok(String(q.domain) in pyTaxonomy.domains, q.id);
    assert.ok(LETTERS.every((L) => typeof q.options[L] === 'string'), q.id);
    assert.ok(LETTERS.includes(q.answer), q.id);
    assert.ok(TRACKS.python.types.includes(q.type), q.id);
    if (q.code) assert.equal(q.verify, 'stdout', `${q.id} has code but is not run by the validator`);
  }
  assert.ok(pyBank.some((q) => !q.code), 'some questions can be read aloud, for commute mode');
});

test('Python questions quote only the public validation scripts and contain no machine paths', () => {
  const text = JSON.stringify(pyBank);
  assert.ok(!/[A-Z]:\\\\|\/Users\/|\/home\//.test(text));
  for (const q of pyBank) assert.match(q.references_topic, /^(validate|audit)\.py /, q.id);
});

test('the deploy copies the Python bank and the offline cache knows about it', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /cp -r lib data data-python _site\//);
  assert.match(ci, /validate\.py --data-dir data-python/);
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'data-python/manifest.json'"));
  assert.ok(sw.includes("'data-python'"));
});
