// Voice-answer controller. Owns the microphone and coordinates it with read-aloud speech.
// It never receives question data or answer keys: only the actions listed in createVoice.
// Recognition, speech, and timers are injectable so tests can pass mocks.
import { interpret } from './voice-parse.js';
import { initialFlow, step, MESSAGES } from './voice-flow.js';

export const SETTLE_MS = 250; // quiet gap after speech ends, so the mic does not hear the speaker tail
export const LISTEN_TIMEOUT_MS = 12000;
export const MAX_SILENT_RESTARTS = 3;

export function recognitionCtor(g = globalThis) {
  return g.SpeechRecognition || g.webkitSpeechRecognition || null;
}

export function isSupported(g = globalThis) {
  return !!recognitionCtor(g);
}

const FATAL_ERRORS = {
  'audio-capture': MESSAGES.noMic,
  network: MESSAGES.network,
  'language-not-supported': MESSAGES.unavailable,
  'bad-grammar': MESSAGES.unavailable,
};
const PERMISSION_ERRORS = ['not-allowed', 'service-not-allowed'];

const describe = (intent) => {
  if (intent.type === 'letter') return `Letter ${intent.letter}`;
  if (intent.type === 'command') return `Command: ${intent.name}`;
  if (intent.type === 'yes') return 'Confirmed';
  if (intent.type === 'no') return 'Change';
  if (intent.type === 'ambiguous') return 'Not clear';
  return 'Not recognised';
};

// actions: { readQuestion(), record(letter), next() -> bool, previous() -> bool, toggleFlag() -> bool, submit() -> { status, message? } }
// speech: the read-aloud controller ({ state, play(chunks), stop() }), or null when speech output is unavailable.
export function createVoice({
  Recognition = recognitionCtor(),
  speech = null,
  actions,
  timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) },
  onChange = () => {},
  lang = 'en-US',
  settleMs = SETTLE_MS,
} = {}) {
  let enabled = false;
  let handsFree = false;
  let confirmAnswers = true;
  let mic = 'idle';
  let heard = '';
  let parsed = '';
  let message = '';
  let flow = initialFlow();
  let rec = null;
  let gen = 0;
  let pending = null;
  let flushToken = 0;
  let starting = false;
  let granted = false;
  let silentRestarts = 0;
  let quietNext = false; // the next listen is an optional follow-up, so silence is not an error
  let listenTimer = null;

  const speechState = () => (speech ? speech.state : 'idle');
  const snapshot = () => ({ supported: !!Recognition, canSpeak: !!speech, enabled, handsFree, confirmAnswers, mic, heard, parsed, message });
  const emit = () => onChange(snapshot());
  const setMic = (m) => { mic = m; emit(); };
  const setMessage = (m) => { message = m; emit(); };

  function clearListenTimer() {
    if (listenTimer != null) timers.clearTimeout(listenTimer);
    listenTimer = null;
  }

  function abortRec() {
    gen++;
    clearListenTimer();
    if (rec) {
      const r = rec;
      rec = null;
      r.onstart = r.onresult = r.onerror = r.onend = null;
      try { r.abort(); } catch { /* already stopped */ }
    }
    if (mic !== 'idle') setMic('idle');
  }

  // Stop the mic and drop anything queued. Called on navigation, submit, hide, and unload.
  function interrupt() {
    flushToken++;
    pending = null;
    flow = initialFlow();
    silentRestarts = 0;
    abortRec();
  }

  // Runs the queued action once speech is idle again, after a short settle gap.
  function scheduleFlush() {
    const token = ++flushToken;
    timers.setTimeout(() => {
      if (token !== flushToken || speechState() !== 'idle') return;
      const fn = pending;
      pending = null;
      if (fn) fn();
    }, settleMs);
  }

  // Speak a short line, then run `after` once speech has fully ended.
  function speakThen(text, after) {
    pending = after || null;
    if (!speech) {
      const fn = pending;
      pending = null;
      if (fn) fn();
      return;
    }
    starting = true;
    try { speech.play([{ text, pause: 0 }]); } finally { starting = false; }
    if (speech.state === 'idle' && pending) scheduleFlush();
  }

  function playThenListen(play) {
    pending = listen;
    if (!speech) {
      pending = null;
      play();
      listen();
      return;
    }
    starting = true;
    try { play(); } finally { starting = false; }
    if (speech.state === 'idle') scheduleFlush();
  }

  function permissionProblem() {
    abortRec();
    if (granted) {
      // Permission was fine earlier, so this is a browser that wants a tap before each start (mobile Safari).
      pending = null;
      setMessage(MESSAGES.needTap);
      return;
    }
    fatal(MESSAGES.denied);
  }

  function fatal(text) {
    interrupt();
    enabled = false;
    handsFree = false;
    setMessage(text);
  }

  function listen() {
    if (!enabled || !Recognition || rec) return false;
    if (speechState() !== 'idle') {
      pending = listen; // never open the mic while speech is playing or paused
      return false;
    }
    const myGen = ++gen;
    const quiet = quietNext;
    quietNext = false;
    let finalAlts = null;
    let interimAlts = null;
    let error = null;
    const r = new Recognition();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 5;
    r.onstart = () => {
      if (myGen !== gen) return;
      granted = true;
      message = '';
      setMic('listening');
    };
    r.onresult = (e) => {
      if (myGen !== gen) return;
      const last = e.results[e.results.length - 1];
      if (!last) return;
      const alts = Array.from({ length: last.length }, (_, i) => ({ transcript: last[i].transcript, confidence: last[i].confidence }));
      if (last.isFinal) {
        finalAlts = alts;
        setMic('processing');
        try { r.stop(); } catch { /* ends on its own */ }
      } else {
        interimAlts = alts.map((a) => ({ ...a, interim: true }));
        heard = alts[0] ? alts[0].transcript : heard;
        emit();
      }
    };
    r.onerror = (e) => { error = (e && e.error) || 'unknown'; };
    r.onend = () => {
      if (myGen !== gen || rec !== r) return; // ignore aborted sessions and duplicate end events
      clearListenTimer();
      rec = null;
      finished({ finalAlts, interimAlts, error, quiet });
    };
    rec = r;
    try {
      r.start();
    } catch {
      rec = null;
      setMessage(MESSAGES.needTap);
      return false;
    }
    setMessage(granted ? '' : MESSAGES.waiting);
    listenTimer = timers.setTimeout(() => {
      if (myGen === gen && rec) {
        try { rec.stop(); } catch { /* ends on its own */ }
      }
    }, LISTEN_TIMEOUT_MS);
    return true;
  }

  function listenQuietly() {
    quietNext = true;
    return listen();
  }

  function finished({ finalAlts, interimAlts, error, quiet }) {
    if (mic !== 'idle') setMic('idle');
    if (PERMISSION_ERRORS.includes(error)) return permissionProblem();
    if (error && FATAL_ERRORS[error]) return fatal(FATAL_ERRORS[error]);

    const alts = [...(finalAlts || []), ...(interimAlts || [])];
    if (!alts.length && error && !['no-speech', 'aborted'].includes(error)) message = MESSAGES.micStopped(error);
    if (!alts.length) {
      // Chrome ends a session on its own after a while. Quietly reopen it while hands-free is on.
      const sessionEnded = !error || error === 'aborted';
      if (sessionEnded && handsFree && silentRestarts < MAX_SILENT_RESTARTS) {
        silentRestarts++;
        listen();
        return;
      }
      silentRestarts = 0;
      if (quiet) {
        flow = initialFlow();
        return; // nothing said after a saved answer: just stop listening
      }
      heard = '';
      parsed = 'Nothing heard';
      emit();
      return run(step(flow, { type: 'silence' }, { confirm: confirmAnswers }));
    }
    silentRestarts = 0;
    const intent = interpret(alts, flow.phase);
    heard = intent.heard;
    parsed = describe(intent);
    emit();
    return run(step(flow, intent, { confirm: confirmAnswers }));
  }

  // In hands-free mode a saved answer moves straight on to the next question.
  function advanceAfterSave() {
    interrupt();
    if (!actions.next()) {
      setMessage(MESSAGES.lastSaved);
      speakThen(MESSAGES.lastSaved, listenQuietly);
    }
  }

  function run(result) {
    flow = result.flow;
    for (const fx of result.effects) {
      if (fx.do === 'record') {
        actions.record(fx.letter);
        message = MESSAGES.recorded(fx.letter);
        emit();
        if (handsFree) return advanceAfterSave();
      } else if (fx.do === 'say') {
        const after = fx.listen === true ? listen : fx.listen === 'handsfree' && handsFree ? listenQuietly : null;
        speakThen(fx.text, after);
      } else if (fx.do === 'listen') {
        if (handsFree) {
          pending = listenQuietly;
          scheduleFlush();
        }
      } else if (fx.do === 'command') {
        runCommand(fx.name);
      } else if (fx.do === 'fallback') {
        setMessage(MESSAGES.tapToTalk);
      }
    }
  }

  function afterNotice(text) {
    speakThen(text, handsFree ? listen : null);
  }

  function runCommand(name) {
    switch (name) {
      case 'next':
      case 'skip':
        interrupt();
        if (!actions.next()) afterNotice(MESSAGES.lastQuestion);
        break;
      case 'previous':
        interrupt();
        if (!actions.previous()) afterNotice(MESSAGES.firstQuestion);
        break;
      case 'repeat':
        interrupt();
        playThenListen(() => actions.readQuestion());
        break;
      case 'flag':
        afterNotice(actions.toggleFlag() ? MESSAGES.flagged : MESSAGES.unflagged);
        break;
      case 'stop':
        interrupt();
        handsFree = false;
        if (speech) speech.stop();
        setMessage(MESSAGES.stopped);
        break;
      case 'submit': {
        interrupt();
        const result = actions.submit();
        if (result.status === 'blocked') afterNotice(result.message);
        else if (result.status === 'confirm') speakThen(MESSAGES.confirmOnScreen, null);
        break;
      }
      default:
        break;
    }
  }

  // Call from the read-aloud controller's change callback.
  function onSpeechState(state) {
    if (starting) return;
    if (state === 'idle') {
      if (pending) scheduleFlush();
    } else if (rec) {
      // Speech started while the mic was open: close the mic and come back afterwards.
      abortRec();
      pending = pending || listen;
    }
  }

  function beginQuestion() {
    if (!enabled || !handsFree) return false;
    flow = initialFlow();
    silentRestarts = 0;
    heard = '';
    parsed = '';
    emit();
    message = MESSAGES.reading;
    emit();
    playThenListen(() => actions.readQuestion());
    return true;
  }

  // Push-to-talk. Call from a click or key press so browsers that need a gesture allow the mic.
  function pushToTalk() {
    if (!enabled) return;
    if (rec) {
      interrupt();
      return;
    }
    interrupt();
    if (speech) speech.stop();
    heard = '';
    parsed = '';
    emit();
    listen();
  }

  function enable() {
    enabled = true;
    setMessage(MESSAGES.enabled);
  }

  function disable() {
    interrupt();
    if (speech) speech.stop();
    enabled = false;
    handsFree = false;
    setMessage('');
  }

  function setConfirm(on) {
    confirmAnswers = !!on;
    emit();
  }

  function setHandsFree(on) {
    if (!enabled || !speech) return false;
    handsFree = !!on;
    if (handsFree) {
      beginQuestion();
    } else {
      interrupt();
      speech.stop();
    }
    emit();
    return true;
  }

  return {
    enable,
    disable,
    setHandsFree,
    setConfirm,
    pushToTalk,
    beginQuestion,
    interrupt,
    onSpeechState,
    get enabled() { return enabled; },
    get handsFree() { return handsFree; },
    get confirmAnswers() { return confirmAnswers; },
    get mic() { return mic; },
    get view() { return snapshot(); },
  };
}
