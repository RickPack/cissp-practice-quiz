import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createVoice, isSupported, recognitionCtor, SETTLE_MS, LISTEN_TIMEOUT_MS, MAX_SILENT_RESTARTS } from '../lib/voice.js';
import { createSpeech } from '../lib/speech.js';
import { MESSAGES } from '../lib/voice-flow.js';

// ---------- Mocks ----------

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

// Timers that wait until the test runs them, so the settle gap and listen timeout are controllable.
function manualTimers() {
  let queue = [];
  let id = 0;
  return {
    setTimeout(fn, ms) { queue.push({ id: ++id, fn, ms }); return id; },
    clearTimeout(i) { queue = queue.filter((t) => t.id !== i); },
    // Runs queued timers up to maxMs (the settle gap by default), leaving the long listen timeout alone.
    run(maxMs = SETTLE_MS) {
      const due = queue.filter((t) => t.ms <= maxMs);
      queue = queue.filter((t) => t.ms > maxMs);
      for (const t of due) t.fn();
    },
    get size() { return queue.length; },
  };
}

function makeResult(alts, isFinal) {
  const res = alts.map(([transcript, confidence]) => ({ transcript, confidence }));
  res.isFinal = isFinal;
  return { results: [res] };
}

function harness({ withSpeech = true, Recognition: Override } = {}) {
  const synth = mockSynth();
  const timers = manualTimers();
  const recs = [];
  const startedWhileSpeaking = [];
  const views = [];
  let voice;
  const speech = withSpeech
    ? createSpeech({ synth, Utterance: MockUtterance, storage: memoryStorage(), timers: instantTimers, onChange: (s) => voice.onSpeechState(s) })
    : null;

  class MockRecognition {
    constructor() {
      this.stopped = false;
      this.aborted = false;
      this.started = false;
      recs.push(this);
    }
    start() {
      this.started = true;
      startedWhileSpeaking.push(synth.current !== null || (speech ? speech.state !== 'idle' : false));
    }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    // Drives one full recognition session like a browser would.
    hear(alts, { interim } = {}) {
      this.onstart?.();
      if (interim) this.onresult?.(makeResult(interim, false));
      this.onresult?.(makeResult(alts, true));
      this.onend?.();
    }
    silence() { this.onstart?.(); this.onend?.(); }
    // Browsers do not fire start when permission is refused, so a denial passes started: false.
    fail(error, { started = true } = {}) { if (started) this.onstart?.(); this.onerror?.({ error }); this.onend?.(); }
  }

  const calls = { recorded: [], next: 0, previous: 0, flag: 0, submit: 0, read: 0 };
  let flagged = false;
  let submitResult = { status: 'blocked', message: 'Answer at least 20 questions to submit (3 more to go).' };
  const actions = {
    readQuestion() {
      calls.read++;
      speech.play([{ text: 'Question 1.', pause: 0 }, { text: 'Option A. First thing.', pause: 0 }, { text: 'Option B. Second thing.', pause: 0 }]);
    },
    record(letter) { calls.recorded.push(letter); },
    next() { calls.next++; return true; },
    previous() { calls.previous++; return false; },
    toggleFlag() { calls.flag++; flagged = !flagged; return flagged; },
    submit() { calls.submit++; return submitResult; },
  };

  voice = createVoice({ Recognition: Override === undefined ? MockRecognition : Override, speech, actions, timers, onChange: (v) => views.push(v) });
  const finishSpeech = () => { while (synth.current) synth.finish(); };
  return {
    voice, speech, synth, timers, recs, calls, views, startedWhileSpeaking, finishSpeech,
    setSubmit(r) { submitResult = r; },
    spokenTexts: () => synth.spoken.map((u) => u.text),
    // Let the last utterance end and the settle gap pass, as in real time.
    settle() { finishSpeech(); timers.run(); },
  };
}

// ---------- Support detection ----------

test('feature detection', () => {
  assert.equal(isSupported({}), false);
  assert.equal(isSupported({ webkitSpeechRecognition: class {} }), true);
  assert.equal(isSupported({ SpeechRecognition: class {} }), true);
  assert.equal(recognitionCtor({}), null);
});

test('without recognition support the controller does nothing and does not throw', () => {
  const h = harness({ Recognition: null });
  h.voice.enable();
  h.voice.pushToTalk();
  h.voice.setHandsFree(true);
  h.settle();
  assert.equal(h.recs.length, 0);
  assert.equal(h.voice.view.supported, false);
});

test('voice is off until enabled: push-to-talk does nothing', () => {
  const h = harness();
  h.voice.pushToTalk();
  assert.equal(h.recs.length, 0);
  assert.equal(h.voice.enabled, false);
  assert.equal(h.voice.handsFree, false);
});

// ---------- Answering and confirmation ----------

test('a heard letter is read back and recorded only after "yes"', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].hear([['bee', 0.9]]);
  assert.deepEqual(h.calls.recorded, [], 'not recorded before confirmation');
  assert.equal(h.spokenTexts()[0], 'You said B. Say yes to confirm, or say a different letter.');
  assert.equal(h.voice.view.heard, 'bee');
  assert.equal(h.voice.view.parsed, 'Letter B');
  h.settle();
  assert.equal(h.recs.length, 2, 'listens again for the confirmation');
  h.recs[1].hear([['yes', 0.9]]);
  assert.deepEqual(h.calls.recorded, ['B']);
  h.settle();
  assert.equal(h.recs.length, 2, 'push-to-talk does not keep listening after saving');
});

test('"no" discards the pending letter and asks again', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].hear([['see', 0.9]]);
  h.settle();
  h.recs[1].hear([['no', 0.9]]);
  assert.deepEqual(h.calls.recorded, []);
  assert.equal(h.spokenTexts().at(-1), MESSAGES.which);
  h.settle();
  h.recs[2].hear([['dee', 0.9]]);
  h.settle();
  h.recs[3].hear([['confirm', 0.9]]);
  assert.deepEqual(h.calls.recorded, ['D']);
});

test('interim text rescues a garbled final transcript', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].hear([['beam', 0.5]], { interim: [['bee', 0.5]] });
  assert.equal(h.voice.view.parsed, 'Letter B');
});

test('unrecognised speech re-listens twice, then falls back to tapping', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].hear([['banana', 0.9]]);
  assert.equal(h.spokenTexts().at(-1), MESSAGES.noCatch);
  h.settle();
  h.recs[1].hear([['b or c', 0.9]]);
  assert.equal(h.spokenTexts().at(-1), MESSAGES.noCatch);
  h.settle();
  assert.equal(h.recs.length, 3);
  h.recs[2].hear([['banana', 0.9]]);
  assert.equal(h.spokenTexts().at(-1), MESSAGES.fallback);
  h.settle();
  assert.equal(h.recs.length, 3, 'no fourth attempt');
  assert.equal(h.voice.view.message, MESSAGES.tapToTalk);
  assert.deepEqual(h.calls.recorded, []);
});

test('the no-speech error counts as a miss', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].fail('no-speech');
  assert.equal(h.spokenTexts().at(-1), MESSAGES.noCatch);
  h.settle();
  assert.equal(h.recs.length, 2);
});

// ---------- Mic never listens while speaking ----------

test('hands-free: reads the question, and the mic opens only after the last utterance and the settle gap', () => {
  const h = harness();
  h.voice.enable();
  h.voice.setHandsFree(true);
  assert.deepEqual(h.spokenTexts(), ['Question 1.']);
  assert.equal(h.recs.length, 0);
  h.synth.finish();
  assert.equal(h.recs.length, 0);
  h.synth.finish();
  assert.equal(h.recs.length, 0);
  assert.equal(h.spokenTexts().length, 3);
  h.synth.finish(); // last utterance ends
  assert.equal(h.recs.length, 0, 'still waiting for the settle gap');
  h.timers.run();
  assert.equal(h.recs.length, 1);
  assert.deepEqual(h.startedWhileSpeaking, [false]);
});

test('the settle gap is re-checked: speech that restarts in the gap keeps the mic closed', () => {
  const h = harness();
  h.voice.enable();
  h.voice.setHandsFree(true);
  h.finishSpeech();
  h.speech.play([{ text: 'Reading again.', pause: 0 }]); // user taps Read aloud inside the gap
  h.timers.run();
  assert.equal(h.recs.length, 0);
  h.settle();
  assert.deepEqual(h.startedWhileSpeaking.every((x) => x === false), true);
});

test('speech starting while the mic is open closes the mic, then it reopens after the speech', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].onstart();
  assert.equal(h.voice.mic, 'listening');
  h.speech.play([{ text: 'Read aloud pressed.', pause: 0 }]);
  assert.equal(h.recs[0].aborted, true);
  assert.equal(h.voice.mic, 'idle');
  assert.equal(h.recs.length, 1, 'no new session while speaking');
  h.settle();
  assert.equal(h.recs.length, 2);
  assert.ok(h.startedWhileSpeaking.every((x) => x === false));
});

test('push-to-talk silences read-aloud before it listens', () => {
  const h = harness();
  h.voice.enable();
  h.speech.play([{ text: 'Reading.', pause: 0 }]);
  h.voice.pushToTalk();
  assert.equal(h.speech.state, 'idle');
  assert.equal(h.recs.length, 1);
  assert.deepEqual(h.startedWhileSpeaking, [false]);
});

test('a paused read-aloud also keeps the mic closed', () => {
  const h = harness();
  h.voice.enable();
  h.voice.setHandsFree(true);
  h.speech.pause();
  h.timers.run();
  assert.equal(h.recs.length, 0);
});

test('without speech output the mic starts without waiting', () => {
  const h = harness({ withSpeech: false });
  h.voice.enable();
  h.voice.pushToTalk();
  assert.equal(h.recs.length, 1);
  assert.equal(h.voice.setHandsFree(true), false, 'hands-free needs speech output');
});

// ---------- Stop on navigate, submit, unload ----------

test('interrupt (navigation, unload, hide) closes an open mic', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].onstart();
  h.voice.interrupt();
  assert.equal(h.recs[0].aborted, true);
  assert.equal(h.voice.mic, 'idle');
});

test('interrupt cancels a queued listen so the mic never opens after navigating', () => {
  const h = harness();
  h.voice.enable();
  h.voice.setHandsFree(true);
  h.finishSpeech(); // reading done, listen is queued behind the settle gap
  h.voice.interrupt(); // user moved to another question
  h.timers.run();
  assert.equal(h.recs.length, 0);
});

test('a late event from an aborted session is ignored', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  const old = h.recs[0];
  const { onend, onresult } = old;
  h.voice.interrupt();
  onresult?.(makeResult([['bee', 0.9]], true));
  onend?.();
  assert.equal(h.spokenTexts().length, 0);
  assert.deepEqual(h.calls.recorded, []);
});

test('"next" voice command stops the mic before navigating', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].hear([['next', 0.9]]);
  assert.equal(h.calls.next, 1);
  h.settle();
  assert.equal(h.recs.length, 1);
});

test('"previous" on the first question says so', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].hear([['previous', 0.9]]);
  assert.equal(h.spokenTexts().at(-1), MESSAGES.firstQuestion);
});

test('"submit" respects the answer gate: blocked submit speaks the reason and records nothing', () => {
  const h = harness();
  h.voice.enable();
  h.voice.setHandsFree(true);
  h.settle();
  h.recs[0].hear([['submit', 0.9]]);
  assert.equal(h.calls.submit, 1);
  assert.equal(h.spokenTexts().at(-1), 'Answer at least 20 questions to submit (3 more to go).');
  assert.deepEqual(h.calls.recorded, []);
});

test('"submit" that needs the dialog leaves the decision on screen and does not listen', () => {
  const h = harness();
  h.setSubmit({ status: 'confirm' });
  h.voice.enable();
  h.voice.setHandsFree(true);
  h.settle();
  h.recs[0].hear([['submit', 0.9]]);
  assert.equal(h.spokenTexts().at(-1), MESSAGES.confirmOnScreen);
  h.settle();
  assert.equal(h.recs.length, 1, 'the mic stays closed while the dialog is open');
});

test('flag, repeat, and stop listening commands', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].hear([['flag', 0.9]]);
  assert.equal(h.calls.flag, 1);
  assert.equal(h.spokenTexts().at(-1), MESSAGES.flagged);
  h.voice.pushToTalk();
  h.recs[1].hear([['repeat', 0.9]]);
  assert.equal(h.calls.read, 1);
  h.settle();
  assert.equal(h.recs.length, 3, 'repeat reads, then listens');
  h.recs[2].hear([['stop listening', 0.9]]);
  assert.equal(h.voice.handsFree, false);
  h.settle();
  assert.equal(h.recs.length, 3);
});

// ---------- Browser quirks ----------

test('hands-free reopens the mic when Chrome ends a session without a result', () => {
  const h = harness();
  h.voice.enable();
  h.voice.setHandsFree(true);
  h.settle();
  const spokenBefore = h.spokenTexts().length;
  h.recs[0].silence();
  assert.equal(h.recs.length, 2, 'restarted');
  assert.equal(h.spokenTexts().length, spokenBefore, 'silently, with no "didn\'t catch that"');
  for (let i = 1; i < MAX_SILENT_RESTARTS; i++) h.recs[i].silence();
  assert.equal(h.recs.length, MAX_SILENT_RESTARTS + 1);
  h.recs[MAX_SILENT_RESTARTS].silence();
  assert.equal(h.spokenTexts().at(-1), MESSAGES.noCatch, 'then it counts as a miss');
});

test('the listen timeout stops a session that hears nothing', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].onstart();
  h.timers.run(LISTEN_TIMEOUT_MS);
  assert.equal(h.recs[0].stopped, true);
});

test('permission denied turns voice off with a friendly message', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  h.recs[0].fail('not-allowed', { started: false });
  assert.equal(h.voice.enabled, false);
  assert.equal(h.voice.view.message, MESSAGES.denied);
  assert.match(h.voice.view.message, /still tap or type/);
  h.voice.pushToTalk();
  assert.equal(h.recs.length, 1);
});

test('missing microphone and network errors turn voice off', () => {
  for (const [error, expected] of [['audio-capture', MESSAGES.noMic], ['network', MESSAGES.network]]) {
    const h = harness();
    h.voice.enable();
    h.voice.pushToTalk();
    h.recs[0].fail(error);
    assert.equal(h.voice.enabled, false, error);
    assert.equal(h.voice.view.message, expected);
  }
});

test('a browser that wants a gesture after permission was granted asks for a tap instead of switching off', () => {
  const h = harness();
  h.voice.enable();
  h.voice.setHandsFree(true);
  h.settle();
  h.recs[0].hear([['bee', 0.9]]); // permission worked in this session
  h.settle();
  h.recs[1].fail('not-allowed'); // the automatic restart is blocked
  assert.equal(h.voice.enabled, true);
  assert.equal(h.voice.view.message, MESSAGES.needTap);
  h.voice.pushToTalk(); // the tap
  assert.equal(h.recs.length, 3);
});

// ---------- No correctness leak ----------

test('no-correctness-leak: nothing spoken or shown mentions correctness across a full session', () => {
  const h = harness();
  const banned = /\b(correct|incorrect|right|wrong|congrat\w*|well done|good job|nice|missed)\b/i;
  h.voice.enable();
  h.voice.setHandsFree(true);
  h.settle();
  const script = [['bee'], ['yes'], ['flag'], ['banana'], ['dee'], ['no'], ['alpha'], ['alpha'], ['previous'], ['submit']];
  for (const [text] of script) {
    h.settle();
    const rec = h.recs.at(-1);
    if (!rec || rec.stopped || rec.aborted || rec.done) {
      h.voice.pushToTalk();
    }
    h.recs.at(-1).done = true;
    h.recs.at(-1).hear([[text, 0.9]]);
  }
  h.settle();
  for (const text of h.spokenTexts()) assert.ok(!banned.test(text), `spoken: ${text}`);
  for (const v of h.views) {
    assert.ok(!banned.test(v.message), `message: ${v.message}`);
    assert.ok(!banned.test(v.parsed), `parsed: ${v.parsed}`);
  }
  assert.ok(h.spokenTexts().length > 5);
});

test('no-correctness-leak: voice modules take no scoring or answer-key input', () => {
  for (const file of ['voice.js', 'voice-flow.js', 'voice-parse.js']) {
    const src = readFileSync(new URL(`../lib/${file}`, import.meta.url), 'utf8');
    assert.ok(!/from ['"]\.\/core\.js['"]/.test(src), `${file} must not import scoring`);
    assert.ok(!/\.answer\b|explanation|rationale|isCorrect|\bcorrectLetter\b/i.test(src), `${file} must not touch answer data`);
  }
});

test('no-correctness-leak: the app wiring hands voice no answer data', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const block = app.slice(app.indexOf('function setupVoice'), app.indexOf('function readExplanation'));
  assert.ok(block.length > 100, 'setupVoice block found');
  assert.ok(!/\.answer|explanation|rationale|scoreSession|view\.correct|q\./.test(block), 'voice wiring must not read answers or questions');
});

test('voice answers go through the same recordAnswer path as taps', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /record: selectByLetter/);
  assert.match(app, /function selectByKey\(index\)[\s\S]*?recordAnswer\(input\.value\)/);
});

test('a duplicate end event from the browser does not process the result twice', () => {
  const h = harness();
  h.voice.enable();
  h.voice.pushToTalk();
  const rec = h.recs[0];
  rec.hear([['bee', 0.9]]);
  h.settle();
  rec.onend?.(); // stray second end event for the first session
  assert.deepEqual(h.calls.recorded, []);
  assert.equal(h.recs.length, 2);
});

test('confirm off: the letter is recorded immediately and nothing is read back', () => {
  const h = harness();
  h.voice.enable();
  h.voice.setConfirm(false);
  h.voice.pushToTalk();
  h.recs[0].hear([['bee', 0.9]]);
  assert.deepEqual(h.calls.recorded, ['B']);
  assert.equal(h.spokenTexts().length, 0);
  h.settle();
  assert.equal(h.recs.length, 1, 'push-to-talk stops after recording');
});

test('confirm off in hands-free: records, then listens again once speech is idle', () => {
  const h = harness();
  h.voice.enable();
  h.voice.setConfirm(false);
  h.voice.setHandsFree(true);
  h.settle();
  h.recs[0].hear([['dee', 0.9]]);
  assert.deepEqual(h.calls.recorded, ['D']);
  h.timers.run();
  assert.equal(h.recs.length, 2);
  assert.ok(h.startedWhileSpeaking.every((x) => x === false));
});
