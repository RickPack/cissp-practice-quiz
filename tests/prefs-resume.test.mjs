import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPrefs, savePrefs, sanitizePrefs, PREFS_KEY, DEFAULT_PREFS } from '../lib/voice-prefs.js';
import { resumeIndex } from '../lib/resume.js';

const store = (init = {}) => {
  const data = { ...init };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, data };
};

test('defaults: voice off, confirm on', () => {
  assert.deepEqual(loadPrefs(store()), DEFAULT_PREFS);
  assert.equal(DEFAULT_PREFS.voiceEnabled, false);
});

test('prefs round-trip, including unticked boxes', () => {
  const s = store();
  const prefs = { voiceEnabled: true, handsFree: true, confirm: false, autoRead: true };
  savePrefs(prefs, s);
  assert.deepEqual(loadPrefs(s), prefs);
});

test('corrupt or hostile stored prefs fall back to defaults', () => {
  assert.deepEqual(loadPrefs(store({ [PREFS_KEY]: '{bad' })), DEFAULT_PREFS);
  assert.deepEqual(sanitizePrefs({ voiceEnabled: 'yes', confirm: 0, extra: 1 }), DEFAULT_PREFS);
  assert.deepEqual(loadPrefs({ getItem() { throw new Error('blocked'); } }), DEFAULT_PREFS);
  assert.doesNotThrow(() => savePrefs(DEFAULT_PREFS, { setItem() { throw new Error('full'); } }));
});

const session = (answeredIdx, current, n = 6) => ({
  items: Array.from({ length: n }, (_, i) => ({ id: `q${i}` })),
  responses: Object.fromEntries(answeredIdx.map((i) => [`q${i}`, 'A'])),
  current,
});

test('resume stays on the saved question when it is unanswered', () => {
  assert.equal(resumeIndex(session([0, 1], 3)), 3);
});

test('resume skips forward to the next unanswered question', () => {
  assert.equal(resumeIndex(session([0, 1, 2], 2)), 3);
});

test('resume wraps back to the first unanswered question', () => {
  assert.equal(resumeIndex(session([2, 3, 4, 5], 5)), 0);
});

test('resume keeps the saved position when everything is answered', () => {
  assert.equal(resumeIndex(session([0, 1, 2, 3, 4, 5], 4)), 4);
});

test('resume clamps a bad saved index', () => {
  assert.equal(resumeIndex(session([], 99)), 5);
  assert.equal(resumeIndex(session([], -3)), 0);
});
