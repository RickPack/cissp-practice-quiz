import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCommute, ANSWER_WINDOW_MS, COMMUTE_COMMANDS } from '../lib/commute.js';
import { createSpeech } from '../lib/speech.js';
import { SETTLE_MS, POLL_MS } from '../lib/voice.js';
import { MESSAGES } from '../lib/voice-flow.js';
import { recordResult } from '../lib/review-deck.js';

// ---------- Mocks (same pattern as voice.test.mjs) ----------

function mockSynth() {
  const synth = {
    spoken: [],
    current: null,
    speak(u) { synth.spoken.push(u); synth.current = u; },
    cancel() { synth.current = null; },
    pause() {},
    resume() {},
    getVoices() { return []; },
    addEventListener() {},
    finish() { const u = synth.current; synth.current = null; u.onend(); },
  };
  return synth;
}
class MockUtterance { constructor(text) { this.text = text; } }
const memoryStorage = () => ({ getItem: () => null, setItem() {} });
const instantTimers = { setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {} };

function manualTimers() {
  let queue = [];
  let id = 0;
  return {
    setTimeout(fn, ms) { queue.push({ id: ++id, fn, ms }); return id; },
    clearTimeout(i) { queue = queue.filter((t) => t.id !== i); },
    run(maxMs = SETTLE_MS) {
      const due = queue.filter((t) => t.ms <= maxMs);
      queue = queue.filter((t) => t.ms > maxMs);
      for (const t of due) t.fn();
    },
    has(ms) { return queue.some((t) => t.ms === ms); },
  };
}

function makeResult(alts, isFinal) {
  const res = alts.map(([transcript, confidence]) => ({ transcript, confidence }));
  res.isFinal = isFinal;
  return { results: [res] };
}

const TODAY = '2026-10-10';
const KEY = ['B', 'A', 'C', 'D', 'A']; // the app's answer key; the controller never sees it

function harness({ recognition = true, enable = true, confirm = false, notify = true } = {}) {
  const synth = mockSynth();
  const timers = manualTimers();
  let clock = 0;
  const recs = [];
  const startedWhileSpeaking = [];
  const views = [];
  const states = [];
  let commute;
  const speech = createSpeech({ synth, Utterance: MockUtterance, storage: memoryStorage(), timers: instantTimers, onChange: (s) => { if (notify) commute.onSpeechState(s); } });

  class MockRecognition {
    constructor() { this.stopped = false; this.aborted = false; recs.push(this); }
    start() { startedWhileSpeaking.push(synth.current !== null || speech.state !== 'idle'); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    hear(alts) { this.onstart?.(); this.onresult?.(makeResult(alts, true)); this.onend?.(); }
    silence() { this.onstart?.(); this.onend?.(); }
  }

  // An app-like callback set: it owns the key, the tally, and the deck, and hands back opaque speech.
  const deck = { q0: { box: 1, due: '2026-10-09', added: '2026-10-08' }, q2: { box: 3, due: '2026-10-01', added: '2026-09-01' } };
  const log = { answers: [], shown: [], finished: null, tally: { correct: 0, missed: 0, skipped: 0 } };
  const app = {
    question: (i) => [{ text: `Question ${i + 1}.`, pause: 0 }, { text: `Option A for ${i + 1}.`, pause: 0 }],
    result: (i, letter) => {
      log.answers.push([i, letter]);
      const outcome = letter == null ? 'skipped' : letter === KEY[i] ? 'correct' : 'missed';
      log.tally[outcome] += 1;
      if (outcome !== 'skipped') recordResult(deck, `q${i}`, outcome, TODAY);
      return [{ text: `Verdict ${i + 1}: ${outcome}.`, pause: 0 }, { text: `Explanation ${i + 1}.`, pause: 0 }];
    },
    show: (i) => log.shown.push(i),
    finish: ({ stopped }) => {
      log.finished = { stopped };
      return [{ text: stopped ? 'Stopped.' : 'Finished.', pause: 0 }];
    },
  };

  commute = createCommute({
    speech,
    Recognition: recognition ? MockRecognition : null,
    app,
    timers,
    now: () => clock,
    onChange: (s) => states.push(s),
    onVoiceChange: (v) => views.push(v),
  });
  if (recognition && enable) {
    commute.voice.enable();
    commute.voice.setConfirm(confirm);
  }
  const finishSpeech = () => { while (synth.current) synth.finish(); };
  return {
    commute, speech, synth, timers, recs, log, deck, views, states, startedWhileSpeaking,
    spoken: () => synth.spoken.map((u) => u.text),
    tick(ms) { clock += ms; },
    settle() { finishSpeech(); timers.run(); },
    finishSpeech,
  };
}

// ---------- The loop ----------

test('commands are exactly repeat, next, skip, and stop', () => {
  assert.deepEqual(COMMUTE_COMMANDS, ['repeat', 'next', 'skip', 'stop']);
  assert.equal(ANSWER_WINDOW_MS, 8000);
});

test('loop: reads the question, listens only after it ends, speaks the verdict with the mic closed, then the next question listens again', () => {
  const h = harness();
  h.commute.start(3);
  assert.deepEqual(h.spoken(), ['Question 1.']);
  assert.deepEqual(h.log.shown, [0]);
  assert.equal(h.recs.length, 0, 'no mic while the question is read');
  h.settle();
  assert.equal(h.recs.length, 1, 'listens once the question has been read');
  h.recs[0].hear([['bee', 0.9]]);
  assert.deepEqual(h.log.answers, [[0, 'B']]);
  assert.equal(h.spoken().at(-1), 'Verdict 1: correct.');
  assert.equal(h.commute.phase, 'reveal');
  h.synth.finish();
  assert.equal(h.spoken().at(-1), 'Explanation 1.', 'verdict, then the explanation');
  h.settle();
  assert.equal(h.recs.length, 1, 'no listening during the verdict');
  assert.equal(h.spoken().at(-1), 'Question 2.');
  assert.deepEqual(h.log.shown, [0, 1]);
  assert.equal(h.commute.phase, 'question');
  h.settle();
  assert.equal(h.recs.length, 2, 'the next question listens again');
  assert.ok(h.startedWhileSpeaking.every((x) => x === false), 'the mic never opened while speech played');
});

test('confirm preference on: the letter is read back and recorded after "yes"', () => {
  const h = harness({ confirm: true });
  h.commute.start(2);
  h.settle();
  h.recs[0].hear([['see', 0.9]]);
  assert.equal(h.spoken().at(-1), MESSAGES.confirm('C'));
  assert.deepEqual(h.log.answers, []);
  h.settle();
  h.recs[1].hear([['yes', 0.9]]);
  assert.deepEqual(h.log.answers, [[0, 'C']]);
  assert.equal(h.spoken().at(-1), 'Verdict 1: missed.');
});

test('timeout: no answer within 8 seconds is a skip, then the answer is read and the next question listens', () => {
  const h = harness();
  h.commute.start(2);
  h.settle();
  const rec = h.recs[0];
  rec.onstart();
  assert.ok(h.timers.has(ANSWER_WINDOW_MS), 'the listen is limited to the answer window');
  h.tick(ANSWER_WINDOW_MS);
  h.timers.run(ANSWER_WINDOW_MS);
  assert.equal(rec.stopped, true);
  rec.onend(); // the browser ends the session with nothing heard
  assert.deepEqual(h.log.answers, [[0, null]]);
  assert.equal(h.spoken().at(-1), 'Verdict 1: skipped.');
  assert.ok(!h.spoken().includes(MESSAGES.noCatch), 'no "didn\'t catch that" for silence');
  h.settle();
  assert.equal(h.spoken().at(-1), 'Question 2.');
  h.settle();
  assert.equal(h.recs.length, 2);
});

test('a session the browser ends early reopens quietly inside the window, then skips when the window runs out', () => {
  const h = harness();
  h.commute.start(2);
  h.settle();
  h.tick(3000);
  h.recs[0].silence(); // Chrome gave up after 3 seconds
  assert.equal(h.recs.length, 2, 'reopened');
  assert.deepEqual(h.log.answers, []);
  h.tick(5000);
  h.recs[1].silence();
  assert.deepEqual(h.log.answers, [[0, null]], 'skipped at 8 seconds');
});

test('silence never loops forever: repeated instant endings still end in a skip', () => {
  const h = harness();
  h.commute.start(1);
  h.settle();
  for (let i = 0; i < 10 && !h.log.answers.length; i++) h.recs.at(-1).silence();
  assert.deepEqual(h.log.answers, [[0, null]]);
  assert.ok(h.recs.length <= 5);
});

test('"stop" ends the run, says the summary, and the mic stays closed', () => {
  const h = harness();
  h.commute.start(5);
  h.settle();
  h.recs[0].hear([['stop', 0.9]]);
  assert.deepEqual(h.log.finished, { stopped: true });
  assert.equal(h.commute.phase, 'done');
  assert.equal(h.spoken().at(-1), 'Stopped.');
  h.settle();
  h.timers.run(ANSWER_WINDOW_MS);
  assert.equal(h.recs.length, 1, 'no further listening');
  assert.deepEqual(h.log.answers, []);
});

test('"repeat" reads the question again, then listens', () => {
  const h = harness();
  h.commute.start(2);
  h.settle();
  h.recs[0].hear([['repeat', 0.9]]);
  assert.equal(h.spoken().at(-1), 'Question 1.');
  assert.deepEqual(h.log.answers, []);
  h.settle();
  assert.equal(h.recs.length, 2);
});

test('"next" and "skip" reveal the answer and move on', () => {
  for (const word of ['next', 'skip']) {
    const h = harness();
    h.commute.start(2);
    h.settle();
    h.recs[0].hear([[word, 0.9]]);
    assert.deepEqual(h.log.answers, [[0, null]], word);
    assert.equal(h.spoken().at(-1), 'Verdict 1: skipped.');
    h.settle();
    assert.equal(h.spoken().at(-1), 'Question 2.');
  }
});

test('quiz-only commands (flag, submit, previous) are not honoured', () => {
  for (const word of ['flag', 'submit', 'previous']) {
    const h = harness();
    h.commute.start(2);
    h.settle();
    h.recs[0].hear([[word, 0.9]]);
    assert.equal(h.spoken().at(-1), MESSAGES.noCatch, word);
    assert.deepEqual(h.log.answers, []);
    assert.equal(h.commute.phase, 'question');
  }
});

test('unclear answers that use up the retries become a skip instead of asking for a tap', () => {
  const h = harness();
  h.commute.start(2);
  h.settle();
  h.recs[0].hear([['banana', 0.9]]);
  h.settle();
  h.recs[1].hear([['b or c', 0.9]]);
  h.settle();
  h.recs[2].hear([['banana', 0.9]]);
  assert.deepEqual(h.log.answers, [[0, null]]);
  assert.ok(!h.spoken().includes(MESSAGES.fallback));
});

test('the run finishes by itself after the last question and says the summary', () => {
  const h = harness();
  h.commute.start(1);
  h.settle();
  h.recs[0].hear([['alpha', 0.9]]);
  h.settle();
  assert.deepEqual(h.log.finished, { stopped: false });
  assert.equal(h.spoken().at(-1), 'Finished.');
  assert.equal(h.recs.length, 1);
});

// ---------- Review deck updates ----------

test('results update the review deck: correct moves a due card up, a miss resets or adds, a skip changes nothing', () => {
  const h = harness();
  h.commute.start(4);
  h.settle();
  h.recs[0].hear([['bee', 0.9]]); // q0 correct (due card in box 1)
  h.settle();
  h.settle();
  h.recs[1].hear([['dee', 0.9]]); // q1 missed (not in the deck)
  h.settle();
  h.settle();
  h.recs[2].hear([['alpha', 0.9]]); // q2 missed (box 3 card)
  h.settle();
  h.settle();
  h.recs[3].hear([['skip', 0.9]]); // q3 skipped
  h.settle();
  assert.deepEqual(h.log.tally, { correct: 1, missed: 2, skipped: 1 });
  assert.deepEqual(h.deck.q0, { box: 2, due: '2026-10-13', added: '2026-10-08' });
  assert.deepEqual(h.deck.q1, { box: 1, due: '2026-10-11', added: TODAY });
  assert.deepEqual(h.deck.q2, { box: 1, due: '2026-10-11', added: '2026-09-01' });
  assert.equal('q3' in h.deck, false);
  assert.deepEqual(h.log.finished, { stopped: false });
});

// ---------- Without recognition, or with voice off ----------

test('play-only: reads the question, pauses 8 seconds, reads the answer, then moves on', () => {
  for (const opts of [{ recognition: false }, { recognition: true, enable: false }]) {
    const h = harness(opts);
    h.commute.start(2);
    assert.equal(h.spoken().at(-1), 'Question 1.');
    h.settle();
    assert.deepEqual(h.log.answers, [], 'waits for the pause');
    h.timers.run(ANSWER_WINDOW_MS);
    assert.deepEqual(h.log.answers, [[0, null]]);
    assert.equal(h.spoken().at(-1), 'Verdict 1: skipped.');
    h.settle();
    assert.equal(h.spoken().at(-1), 'Question 2.');
    assert.equal(h.recs.length, 0, 'never listens');
  }
});

test('play-only: Next skips to the answer, and Next during the answer moves on', () => {
  const h = harness({ recognition: false });
  h.commute.start(3);
  h.commute.next();
  assert.deepEqual(h.log.answers, [[0, null]]);
  assert.equal(h.spoken().at(-1), 'Verdict 1: skipped.');
  h.commute.next();
  assert.equal(h.spoken().at(-1), 'Question 2.');
  assert.equal(h.commute.index, 1);
});

test('a lost "speech ended" event is recovered by the poll in play-only mode', () => {
  const h = harness({ recognition: false, notify: false }); // the controller is never told when speech changes state
  h.commute.start(2);
  h.finishSpeech(); // speech is idle again, but nobody was told
  h.timers.run(); // settle-length timers only: nothing happens yet
  assert.ok(!h.timers.has(ANSWER_WINDOW_MS));
  h.timers.run(POLL_MS); // the poll notices
  h.timers.run(); // settle gap
  assert.ok(h.timers.has(ANSWER_WINDOW_MS), 'the pause before the answer has started');
  h.timers.run(ANSWER_WINDOW_MS);
  assert.deepEqual(h.log.answers, [[0, null]]);
});

test('an answer tapped on screen works with and without voice', () => {
  for (const opts of [{ recognition: false }, {}]) {
    const h = harness(opts);
    h.commute.start(2);
    h.settle();
    assert.equal(h.commute.answer('B'), true);
    assert.deepEqual(h.log.answers, [[0, 'B']]);
    assert.equal(h.spoken().at(-1), 'Verdict 1: correct.');
    assert.equal(h.commute.answer('C'), false, 'one answer per question');
    if (h.recs[0]) assert.equal(h.recs[0].aborted, true, 'the open mic was closed');
  }
});

// ---------- Pausing, resuming, and switching voice ----------

test('pause (screen locked or tab hidden) closes the mic and stops speech; resume reads the question again', () => {
  const h = harness();
  h.commute.start(2);
  h.settle();
  h.recs[0].onstart();
  h.commute.pause();
  assert.equal(h.recs[0].aborted, true);
  assert.equal(h.speech.state, 'idle');
  h.timers.run(ANSWER_WINDOW_MS);
  assert.deepEqual(h.log.answers, [], 'no skip while paused');
  h.commute.resume();
  assert.equal(h.spoken().at(-1), 'Question 1.');
  h.settle();
  assert.equal(h.recs.length, 2);
});

test('leaving the screen stops everything and nothing restarts', () => {
  const h = harness();
  h.commute.start(2);
  h.commute.leave();
  h.settle();
  h.timers.run(ANSWER_WINDOW_MS);
  assert.equal(h.recs.length, 0);
  assert.equal(h.commute.phase, 'idle');
});

test('turning voice off mid-run carries on in play-only mode; turning it on listens again', () => {
  const h = harness();
  h.commute.start(3);
  h.settle();
  h.commute.voice.disable();
  h.commute.voiceChanged();
  assert.equal(h.spoken().at(-1), 'Question 1.');
  h.settle();
  h.timers.run(ANSWER_WINDOW_MS);
  assert.deepEqual(h.log.answers, [[0, null]]);
  h.settle();
  assert.equal(h.spoken().at(-1), 'Question 2.');
  h.commute.voice.enable();
  h.commute.voiceChanged();
  h.settle();
  assert.equal(h.recs.length, 2, 'listening again');
});

test('a browser that needs a tap for each mic start waits for Talk instead of skipping', () => {
  const h = harness();
  h.commute.start(2);
  h.settle();
  h.recs[0].hear([['bee', 0.9]]); // permission granted earlier in the run
  h.settle();
  h.settle();
  h.recs[1].onerror({ error: 'not-allowed' });
  h.recs[1].onend();
  assert.equal(h.commute.voice.view.message, MESSAGES.needTap);
  assert.equal(h.commute.phase, 'question');
  h.commute.voice.pushToTalk();
  assert.equal(h.recs.length, 3);
});

// ---------- Separation rules ----------

test('the commute controller takes no answer data and does not import scoring', () => {
  const src = readFileSync(new URL('../lib/commute.js', import.meta.url), 'utf8');
  assert.ok(!/from ['"]\.\/core\.js['"]/.test(src));
  assert.ok(!/\.answer\b|explanation\b|rationale|isCorrect|localStorage|cissp-diagnostic:/i.test(src));
});
