export const RATE_MIN = 0.75;
export const RATE_MAX = 1.75;
export const SETTINGS_KEY = 'cissp-diagnostic:speech';
const DEFAULTS = { voiceURI: '', rate: 1, volume: 1 };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function isSupported(g = globalThis) {
  return !!(g.speechSynthesis && g.SpeechSynthesisUtterance);
}

// Prefer English voices, local (offline) ones first.
export function englishVoices(all) {
  return all
    .filter((v) => /^en(-|_|$)/i.test(v.lang || ''))
    .sort((a, b) => Number(!!b.localService) - Number(!!a.localService));
}

// synth, Utterance, storage and timers are injectable so tests can pass mocks.
export function createSpeech({
  synth,
  Utterance = globalThis.SpeechSynthesisUtterance,
  storage = globalThis.localStorage,
  timers = { setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a) },
  onChange = () => {},
} = {}) {
  let settings = { ...DEFAULTS };
  let voices = [];
  let state = 'idle';
  let queue = [];
  let index = 0;
  let gen = 0;
  let timer = null;
  let waiting = false;

  try {
    const saved = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      settings = {
        voiceURI: typeof saved.voiceURI === 'string' ? saved.voiceURI : '',
        rate: clamp(Number(saved.rate) || 1, RATE_MIN, RATE_MAX),
        volume: clamp(Number.isFinite(Number(saved.volume)) ? Number(saved.volume) : 1, 0, 1),
      };
    }
  } catch {
    // Storage unavailable or corrupt: use defaults.
  }

  const persist = () => {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Settings last for this page view only.
    }
  };
  const setState = (s) => {
    state = s;
    onChange(s);
  };

  function refreshVoices() {
    voices = englishVoices(synth.getVoices());
    return voices;
  }
  function selectedVoice() {
    return voices.find((v) => v.voiceURI === settings.voiceURI) || voices[0] || null;
  }

  function speakNext() {
    if (index >= queue.length) {
      queue = [];
      setState('idle');
      return;
    }
    const myGen = gen;
    const { text, pause } = queue[index++];
    const u = new Utterance(text);
    const v = selectedVoice();
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    } else {
      u.lang = 'en-US';
    }
    u.rate = settings.rate;
    u.volume = settings.volume;
    u.onend = () => {
      if (myGen !== gen) return;
      const advance = () => {
        timer = null;
        if (myGen !== gen) return;
        if (state === 'paused') waiting = true;
        else speakNext();
      };
      if (pause > 0 && index < queue.length) timer = timers.setTimeout(advance, pause);
      else advance();
    };
    u.onerror = (e) => {
      if (myGen !== gen) return;
      if (e && (e.error === 'canceled' || e.error === 'interrupted')) return;
      stop();
    };
    synth.speak(u);
  }

  function play(chunks) {
    stop();
    if (!chunks || !chunks.length) return;
    queue = chunks;
    index = 0;
    setState('playing');
    speakNext();
  }

  function stop() {
    gen++;
    waiting = false;
    if (timer != null) timers.clearTimeout(timer);
    timer = null;
    queue = [];
    index = 0;
    synth.cancel();
    if (state !== 'idle') setState('idle');
  }

  function pause() {
    if (state !== 'playing') return;
    synth.pause();
    setState('paused');
  }

  function resume() {
    if (state !== 'paused') return;
    setState('playing');
    synth.resume();
    if (waiting) {
      waiting = false;
      speakNext();
    }
  }

  function set(key, value) {
    if (key === 'rate') settings.rate = clamp(Number(value) || 1, RATE_MIN, RATE_MAX);
    else if (key === 'volume') settings.volume = clamp(Number(value), 0, 1);
    else if (key === 'voiceURI') settings.voiceURI = String(value);
    else return;
    persist();
  }

  function init() {
    refreshVoices();
    const again = () => {
      refreshVoices();
      onChange(state);
    };
    if (synth.addEventListener) synth.addEventListener('voiceschanged', again);
    else synth.onvoiceschanged = again;
  }

  return {
    init,
    play,
    stop,
    pause,
    resume,
    set,
    refreshVoices,
    get state() { return state; },
    get settings() { return { ...settings }; },
    get voices() { return voices; },
    get voice() { return selectedVoice(); },
  };
}
