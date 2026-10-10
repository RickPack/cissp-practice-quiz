import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPronunciations, chunkText, plainText, questionChunks, explanationChunks, feedbackChunks, MAX_CHUNK } from '../lib/speech-text.js';
import { PRONUNCIATIONS } from '../lib/pronunciations.js';
import { createSpeech, englishVoices, SETTINGS_KEY } from '../lib/speech.js';
import { viewQuestion } from '../lib/core.js';

// ---------- Mocks ----------

function mockSynth(voices = []) {
  const synth = {
    spoken: [],
    current: null,
    cancels: 0,
    paused: false,
    listeners: {},
    voices,
    speak(u) { synth.spoken.push(u); synth.current = u; },
    cancel() { synth.cancels++; synth.current = null; },
    pause() { synth.paused = true; },
    resume() { synth.paused = false; },
    getVoices() { return synth.voices; },
    addEventListener(name, fn) { synth.listeners[name] = fn; },
    finish() { const u = synth.current; synth.current = null; u.onend(); },
  };
  return synth;
}
class MockUtterance { constructor(text) { this.text = text; } }
const memoryStorage = (init = {}) => {
  const data = { ...init };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, data };
};
const instantTimers = { setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {} };
const make = (synth, extra = {}) => createSpeech({ synth, Utterance: MockUtterance, storage: memoryStorage(), timers: instantTimers, ...extra });

const sampleView = {
  number: 3,
  stem: 'Which control is **BEST** for the SIEM team?',
  options: [
    { letter: 'A', text: 'Alpha option.' },
    { letter: 'B', text: 'Bravo option.' },
    { letter: 'C', text: 'Charlie option.' },
    { letter: 'D', text: 'Delta option.' },
  ],
};

// ---------- Text building ----------

test('speaks number, stem, then options in on-screen order with letters', () => {
  const texts = questionChunks(sampleView).map((c) => c.text);
  assert.deepEqual(texts, [
    'Question 3.',
    'Which control is BEST for the sim team?',
    'Option A. Alpha option.',
    'Option B. Bravo option.',
    'Option C. Charlie option.',
    'Option D. Delta option.',
  ]);
});

test('option order follows the shuffled display permutation, not source order', () => {
  const q = {
    answer: 'A',
    options: { A: 'source-a', B: 'source-b', C: 'source-c', D: 'source-d' },
    distractor_rationales: { B: 'rb', C: 'rc', D: 'rd' },
  };
  const view = viewQuestion(q, [2, 0, 3, 1].map((i) => 'ABCD'[i]));
  const texts = questionChunks({ number: 1, stem: 'S.', options: view.options }).map((c) => c.text);
  assert.deepEqual(texts.slice(2), ['Option A. source-c', 'Option B. source-a', 'Option C. source-d', 'Option D. source-b']);
});

test('a pause follows each option but not mid-sentence chunks', () => {
  const chunks = questionChunks({ ...sampleView, stem: `${'Word '.repeat(50)}end. ${'More '.repeat(50)}done.` });
  const stemChunks = chunks.filter((c) => !/^(Question|Option)/.test(c.text));
  assert.ok(stemChunks.length > 1);
  assert.equal(stemChunks.slice(0, -1).every((c) => c.pause === 0), true);
  assert.ok(stemChunks.at(-1).pause > 0);
});

test('quiz speech never contains answer or explanation text', () => {
  const q = {
    answer: 'B',
    options: { A: 'one', B: 'two', C: 'three', D: 'four' },
    explanation: 'SECRET-EXPLANATION',
    distractor_rationales: { A: 'SECRET-WHY-A', C: 'SECRET-WHY-C', D: 'SECRET-WHY-D' },
  };
  const view = viewQuestion(q, ['A', 'B', 'C', 'D']);
  const spoken = questionChunks({ number: 1, stem: 'Stem?', options: view.options }).map((c) => c.text).join(' ');
  assert.doesNotMatch(spoken, /SECRET/);
  assert.doesNotMatch(spoken, /correct/i);
});

test('explanation reading names the correct letter and the explanation', () => {
  const texts = explanationChunks({ correct: 'C', explanation: 'Because AES is symmetric.' }).map((c) => c.text);
  assert.equal(texts[0], 'The correct answer is C.');
  assert.equal(texts[1], 'Because A E S is symmetric.');
});

test('plainText strips emphasis markers', () => {
  assert.equal(plainText('Which is **NOT** allowed?'), 'Which is NOT allowed?');
});

// ---------- Chunking ----------

test('chunks respect the maximum length and keep all words', () => {
  const long = `${'alpha beta, '.repeat(60)}end of sentence. Short one.`;
  const chunks = chunkText(long);
  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((c) => c.length <= MAX_CHUNK), chunks.map((c) => c.length).join(','));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), long.replace(/\s+/g, ' ').trim());
});

test('short sentences are merged and an unbroken long word is hard-split', () => {
  assert.deepEqual(chunkText('One. Two. Three.'), ['One. Two. Three.']);
  const chunks = chunkText('x'.repeat(400));
  assert.ok(chunks.every((c) => c.length <= MAX_CHUNK));
  assert.equal(chunks.join('').length, 400);
});

// ---------- Pronunciations ----------

test('pronunciation map covers the required examples', () => {
  assert.equal(applyPronunciations('SIEM'), 'sim');
  assert.equal(applyPronunciations('AES'), 'A E S');
  assert.equal(applyPronunciations('IPsec'), 'I P sec');
  assert.equal(applyPronunciations('the CIA triad'), 'the C I A triad');
});

test('pronunciations match whole words only and are case-sensitive', () => {
  assert.equal(applyPronunciations('AESTHETIC and aes and AES-256'), 'AESTHETIC and aes and A E S-256');
  assert.equal(applyPronunciations('SIEMENS'), 'SIEMENS');
});

test('pronunciation map entries are well-formed and unique', () => {
  const keys = PRONUNCIATIONS.map(([w]) => w);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(PRONUNCIATIONS.every(([w, s]) => w && s && w !== s));
});

test('pronunciations change spoken text only, never the source question', () => {
  const stem = 'Which SIEM feature helps?';
  questionChunks({ number: 1, stem, options: [] });
  assert.equal(stem, 'Which SIEM feature helps?');
});

// ---------- Controller ----------

test('play speaks chunks one at a time and returns to idle', () => {
  const synth = mockSynth();
  const states = [];
  const sp = make(synth, { onChange: (s) => states.push(s) });
  sp.play(questionChunks(sampleView));
  assert.equal(synth.spoken.length, 1);
  assert.equal(sp.state, 'playing');
  while (synth.current) synth.finish();
  assert.equal(synth.spoken.length, 6);
  assert.equal(sp.state, 'idle');
  assert.deepEqual(states, ['playing', 'idle']);
});

test('pause and resume use the engine and keep position', () => {
  const synth = mockSynth();
  const sp = make(synth);
  sp.play(questionChunks(sampleView));
  sp.pause();
  assert.equal(sp.state, 'paused');
  assert.equal(synth.paused, true);
  sp.resume();
  assert.equal(sp.state, 'playing');
  assert.equal(synth.paused, false);
});

test('a chunk ending while paused waits and continues on resume', () => {
  const synth = mockSynth();
  const sp = make(synth);
  sp.play(questionChunks(sampleView));
  sp.pause();
  synth.finish();
  assert.equal(synth.spoken.length, 1);
  sp.resume();
  assert.equal(synth.spoken.length, 2);
});

test('stop cancels immediately and ignores late end events from the old speech', () => {
  const synth = mockSynth();
  const sp = make(synth);
  sp.play(questionChunks(sampleView));
  const old = synth.current;
  sp.stop();
  assert.equal(synth.cancels >= 1, true);
  assert.equal(sp.state, 'idle');
  old.onend();
  assert.equal(synth.spoken.length, 1);
});

test('starting a new reading cancels the previous one first', () => {
  const synth = mockSynth();
  const sp = make(synth);
  sp.play(questionChunks(sampleView));
  const before = synth.cancels;
  sp.play(questionChunks({ ...sampleView, number: 4 }));
  assert.equal(synth.cancels, before + 1);
  assert.equal(synth.current.text, 'Question 4.');
});

test('cancel-on-navigate: stop() then play() never carries audio over', () => {
  const synth = mockSynth();
  const sp = make(synth);
  sp.play(questionChunks(sampleView));
  sp.stop(); // goTo, finish and pagehide all call this
  const stale = synth.spoken[0];
  stale.onend();
  stale.onerror({ error: 'interrupted' });
  assert.equal(synth.spoken.length, 1);
  assert.equal(sp.state, 'idle');
});

test('canceled/interrupted errors do not stop a newer reading', () => {
  const synth = mockSynth();
  const sp = make(synth);
  sp.play(questionChunks(sampleView));
  synth.current.onerror({ error: 'interrupted' });
  assert.equal(sp.state, 'playing');
  synth.current.onerror({ error: 'synthesis-failed' });
  assert.equal(sp.state, 'idle');
});

test('settings clamp, persist, and load back', () => {
  const store = memoryStorage();
  const sp = make(mockSynth(), { storage: store });
  sp.set('rate', 5);
  sp.set('volume', -1);
  sp.set('voiceURI', 'v2');
  assert.deepEqual(sp.settings, { voiceURI: 'v2', rate: 1.75, volume: 0 });
  const again = make(mockSynth(), { storage: store });
  assert.deepEqual(again.settings, { voiceURI: 'v2', rate: 1.75, volume: 0 });
  sp.set('rate', 0.1);
  assert.equal(sp.settings.rate, 0.75);
});

test('broken or throwing storage falls back to defaults without crashing', () => {
  const bad = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  const sp = make(mockSynth(), { storage: bad });
  assert.deepEqual(sp.settings, { voiceURI: '', rate: 1, volume: 1 });
  sp.set('rate', 1.25);
  assert.equal(sp.settings.rate, 1.25);
  const junk = make(mockSynth(), { storage: memoryStorage({ [SETTINGS_KEY]: '{not json' }) });
  assert.equal(junk.settings.rate, 1);
});

test('voices: English only, local first, default picks the first; applied to utterances', () => {
  const voices = [
    { voiceURI: 'fr', lang: 'fr-FR', localService: true },
    { voiceURI: 'en-net', lang: 'en-US', localService: false },
    { voiceURI: 'en-local', lang: 'en_GB', localService: true },
  ];
  assert.deepEqual(englishVoices(voices).map((v) => v.voiceURI), ['en-local', 'en-net']);
  const synth = mockSynth(voices);
  const sp = make(synth);
  sp.init();
  assert.equal(sp.voice.voiceURI, 'en-local');
  sp.set('voiceURI', 'en-net');
  sp.play([{ text: 'Hi.', pause: 0 }]);
  assert.equal(synth.current.voice.voiceURI, 'en-net');
  assert.equal(synth.current.rate, 1);
});

test('voiceschanged populates voices that load late', () => {
  const synth = mockSynth([]);
  let changes = 0;
  const sp = make(synth, { onChange: () => { changes++; } });
  sp.init();
  assert.equal(sp.voices.length, 0);
  synth.voices = [{ voiceURI: 'late', lang: 'en-US', localService: true }];
  synth.listeners.voiceschanged();
  assert.equal(sp.voices.length, 1);
  assert.ok(changes >= 1);
});

test('feedbackChunks: verdict then the correct letter', () => {
  assert.deepEqual(feedbackChunks({ isCorrect: true, correct: 'B' }).map((c) => c.text), ['Correct.', 'The correct answer is B.']);
  assert.deepEqual(feedbackChunks({ isCorrect: false, correct: 'C' }).map((c) => c.text), ['Not correct.', 'The correct answer is C.']);
});

test('feedbackChunks: reads the explanation after the answer, with pronunciations applied', () => {
  const texts = feedbackChunks({ isCorrect: false, correct: 'A', explanation: 'The SIEM team reviews alerts.' }).map((c) => c.text);
  assert.deepEqual(texts.slice(0, 2), ['Not correct.', 'The correct answer is A.']);
  assert.ok(texts.join(' ').includes('reviews alerts'));
});

test('questionChunks never carries feedback wording', () => {
  const text = questionChunks(sampleView).map((c) => c.text).join(' ');
  assert.ok(!/correct/i.test(text));
});

test('watchdog: an utterance whose end event never fires is finished once the engine is idle', () => {
  const synth = mockSynth();
  synth.speaking = false;
  synth.pending = false;
  const queued = [];
  const timers = { setTimeout: (fn) => { queued.push(fn); return queued.length; }, clearTimeout() {} };
  const states = [];
  const s = createSpeech({ synth, Utterance: MockUtterance, storage: memoryStorage(), timers, onChange: (st) => states.push(st) });
  s.play([{ text: 'One.', pause: 0 }]);
  assert.equal(s.state, 'playing');
  queued.shift()(); // watchdog fires while the engine reports idle and `end` never came
  assert.equal(s.state, 'idle');
});

test('watchdog: leaves a genuinely speaking engine alone', () => {
  const synth = mockSynth();
  synth.speaking = true;
  synth.pending = false;
  const queued = [];
  const timers = { setTimeout: (fn) => { queued.push(fn); return queued.length; }, clearTimeout() {} };
  const s = createSpeech({ synth, Utterance: MockUtterance, storage: memoryStorage(), timers });
  s.play([{ text: 'One.', pause: 0 }]);
  queued.shift()();
  assert.equal(s.state, 'playing');
  assert.equal(queued.length, 1, 're-armed for the next check');
});
