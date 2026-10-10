// Remembers the voice and read-aloud choices across reloads. Storage is injectable for tests.
// Only on/off choices are kept, never audio or transcripts.
export const PREFS_KEY = 'cissp-diagnostic:prefs';
export const DEFAULT_PREFS = { voiceEnabled: false, handsFree: false, confirm: true, autoRead: false, bargeIn: false };

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

export function sanitizePrefs(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    voiceEnabled: bool(r.voiceEnabled, DEFAULT_PREFS.voiceEnabled),
    handsFree: bool(r.handsFree, DEFAULT_PREFS.handsFree),
    confirm: bool(r.confirm, DEFAULT_PREFS.confirm),
    autoRead: bool(r.autoRead, DEFAULT_PREFS.autoRead),
    bargeIn: bool(r.bargeIn, DEFAULT_PREFS.bargeIn),
  };
}

export function loadPrefs(storage = globalThis.localStorage) {
  try {
    return sanitizePrefs(JSON.parse(storage.getItem(PREFS_KEY) || 'null'));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs, storage = globalThis.localStorage) {
  try {
    storage.setItem(PREFS_KEY, JSON.stringify(sanitizePrefs(prefs)));
  } catch {
    // Preferences last for this page view only.
  }
}
