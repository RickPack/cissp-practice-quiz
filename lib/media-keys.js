// Headphone and lock-screen buttons for commute mode, through the Media Session API.
// iOS only routes those buttons to a page that is playing media, so a silent audio loop plays while a run is open.
// Like the other controllers it knows nothing about questions or answers: it forwards four button presses.
// The audio element and mediaSession are injectable so tests can pass mocks.

export const BUTTONS = {
  nexttrack: 'next', // skip the question, or move past the answer
  previoustrack: 'repeat',
  pause: 'pause',
  play: 'resume',
};

export function isSupported(g = globalThis) {
  return !!(g.navigator && g.navigator.mediaSession && g.Audio);
}

// handlers: { next(), repeat(), pause(), resume() }
// audio: an HTMLAudioElement that loops silence. mediaSession: navigator.mediaSession.
export function createMediaKeys({ audio, mediaSession, Metadata = null, handlers, title = 'Commute mode' }) {
  let active = false;

  const setState = (s) => { try { mediaSession.playbackState = s; } catch { /* unsupported */ } };

  function setHandler(action, fn) {
    try { mediaSession.setActionHandler(action, fn); } catch { /* this browser lacks the action */ }
  }

  // Call from a tap: browsers only start audio from a user gesture.
  function start() {
    if (!audio || !mediaSession || active) return false;
    active = true;
    audio.loop = true;
    try {
      const played = audio.play();
      if (played && played.catch) played.catch(() => { /* blocked or interrupted: the buttons just will not appear */ });
    } catch { /* same */ }
    if (Metadata) {
      try { mediaSession.metadata = new Metadata({ title, artist: 'CISSP practice' }); } catch { /* optional */ }
    }
    for (const [action, name] of Object.entries(BUTTONS)) {
      setHandler(action, () => {
        if (!active) return;
        if (name === 'pause') setState('paused');
        if (name === 'resume') setState('playing');
        handlers[name]();
      });
    }
    setState('playing');
    return true;
  }

  function stop() {
    if (!active) return false;
    active = false;
    for (const action of Object.keys(BUTTONS)) setHandler(action, null);
    setState('none');
    try { audio.pause(); } catch { /* already stopped */ }
    return true;
  }

  return { start, stop, get active() { return active; } };
}
