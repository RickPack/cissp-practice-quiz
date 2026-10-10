// Commute mode: an eyes-free study loop. Read a question, listen once for a letter, play the result the app
// supplies (verdict, key, and why), and move on. Feedback is the point here, so this is never a scored session.
// Like the voice controller, it never sees the answer key or question data: the app hands it opaque speech chunks.
// Speech, recognition, timers, and the clock are injectable so tests can pass mocks.
import { createVoice, SETTLE_MS, POLL_MS } from './voice.js';

export const ANSWER_WINDOW_MS = 8000; // silence this long after the question counts as a skip
export const COMMUTE_COMMANDS = ['repeat', 'next', 'skip', 'stop'];

// app: {
//   question(i) -> chunks            what to read for question i (number, stem, options)
//   result(i, letter | null) -> chunks  record the result (null means skipped) and return the speech that reveals it
//   show(i)                          put question i on screen
//   finish({ stopped }) -> chunks    the run is over: show the summary and return what to say
// }
// Without Recognition (or with voice off) it still plays: question, a pause of ANSWER_WINDOW_MS, then the answer.
export function createCommute({
  speech,
  Recognition = null,
  app,
  timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) },
  now,
  onChange = () => {},
  onVoiceChange = () => {},
  settleMs = SETTLE_MS,
  pollMs = POLL_MS,
  answerWindowMs = ANSWER_WINDOW_MS,
}) {
  let total = 0;
  let index = 0;
  let phase = 'idle'; // idle | question | reveal | done
  let thinkTimer = null;
  let wait = null;

  const emit = () => onChange({ phase, index, total });

  const voice = Recognition
    ? createVoice({
        Recognition,
        speech,
        timers,
        now,
        settleMs,
        autoSkipMs: answerWindowMs,
        allowedCommands: COMMUTE_COMMANDS,
        onChange: onVoiceChange,
        actions: {
          readQuestion: () => speech.play(app.question(index)),
          // The voice controller plays these chunks with the mic closed, then calls next().
          record: (letter) => ({ chunks: phase === 'question' ? reveal(letter) : [] }),
          // 'next', 'skip', silence, and too many unclear answers all land here.
          next: () => {
            if (phase === 'question') voice.answeredByHand(reveal(null));
            else advance();
            return true;
          },
          previous: () => false,
          toggleFlag: () => false,
          submit: () => ({ status: 'blocked', message: '' }),
          stop: () => end(true),
        },
      })
    : null;

  const handsFree = () => !!voice && voice.enabled && voice.handsFree;

  // ---------- Waiting for speech to finish (play-only path) ----------

  function poke() {
    if (!wait || speech.state !== 'idle') return;
    const w = wait;
    timers.setTimeout(() => {
      if (wait !== w || speech.state !== 'idle') return;
      wait = null;
      w.fn();
    }, settleMs);
  }

  function poll(w) {
    timers.setTimeout(() => {
      if (wait !== w) return;
      poke(); // safety net if a speech 'ended' event is lost
      poll(w);
    }, pollMs);
  }

  function afterSpeech(fn) {
    wait = { fn };
    poke();
    poll(wait);
  }

  function clearThink() {
    if (thinkTimer != null) timers.clearTimeout(thinkTimer);
    thinkTimer = null;
  }

  // Stop everything that is playing, listening, or waiting, but keep the place in the run.
  function halt() {
    wait = null;
    clearThink();
    if (voice) voice.interrupt();
    speech.stop();
  }

  // ---------- The loop ----------

  function reveal(letter) {
    phase = 'reveal';
    clearThink();
    emit();
    return app.result(index, letter) || [];
  }

  function playReveal(letter) {
    speech.play(reveal(letter));
    afterSpeech(advance);
  }

  function begin() {
    phase = 'question';
    app.show(index);
    emit();
    if (voice && voice.enabled) {
      if (voice.handsFree) voice.beginQuestion();
      else voice.setHandsFree(true); // reads the question, then listens
      return;
    }
    speech.play(app.question(index));
    afterSpeech(() => {
      thinkTimer = timers.setTimeout(() => {
        thinkTimer = null;
        if (phase === 'question') playReveal(null);
      }, answerWindowMs);
    });
  }

  function advance() {
    if (phase !== 'question' && phase !== 'reveal') return;
    index += 1;
    if (index >= total) end(false);
    else begin();
  }

  function end(stopped) {
    if (phase !== 'question' && phase !== 'reveal') return;
    halt();
    phase = 'done';
    emit();
    const chunks = app.finish({ stopped });
    if (chunks && chunks.length) speech.play(chunks);
  }

  // Skip the current question, or cut the answer short and move on.
  function next() {
    if (phase === 'question') {
      if (handsFree()) {
        voice.answeredByHand(reveal(null));
      } else {
        halt();
        playReveal(null);
      }
    } else if (phase === 'reveal') {
      halt();
      advance();
    }
  }

  // An answer tapped on screen.
  function answer(letter) {
    if (phase !== 'question') return false;
    if (handsFree()) {
      voice.answeredByHand(reveal(letter));
    } else {
      halt();
      playReveal(letter);
    }
    return true;
  }

  function repeat() {
    if (phase !== 'question') return;
    halt();
    begin();
  }

  // Start a run of n questions. Call from a tap so browsers allow speech and the mic.
  function start(n) {
    halt();
    total = Math.max(0, n | 0);
    index = 0;
    phase = 'question';
    if (!total) {
      end(false);
      return;
    }
    begin();
  }

  // The screen locked or the tab was hidden: stop the mic and speech. resume() picks up again.
  function pause() {
    halt();
  }

  function resume() {
    if (phase === 'question') begin();
    else if (phase === 'reveal') advance();
  }

  // Voice was turned on or off mid-run: carry on in the new mode.
  function voiceChanged() {
    if (phase === 'question') {
      halt();
      begin();
    } else if (phase === 'reveal') {
      halt();
      advance();
    }
  }

  // Leaving the commute screen.
  function leave() {
    halt();
    phase = 'idle';
    emit();
  }

  function onSpeechState(state) {
    if (voice) voice.onSpeechState(state);
    if (state === 'idle') poke();
  }

  return {
    start,
    next,
    answer,
    repeat,
    stop: () => end(true),
    pause,
    resume,
    voiceChanged,
    leave,
    onSpeechState,
    voice,
    get phase() { return phase; },
    get index() { return index; },
    get total() { return total; },
  };
}
