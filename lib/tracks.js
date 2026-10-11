// Quiz tracks: the CISSP bank and the Python bank built from this repository's own code.
// Pure and DOM-free. Each track has its own data folder and its own storage keys, so sessions and
// review decks never mix (the deck drops IDs its bank does not know, so a shared key would wipe the other track).

export const TRACK_KEY = 'cissp-diagnostic:track';
export const DEFAULT_TRACK = 'cissp';

export const TRACKS = {
  cissp: {
    id: 'cissp',
    label: 'CISSP',
    dataDir: 'data',
    storagePrefix: 'cissp-diagnostic', // unchanged from earlier versions, so saved sessions and decks carry over
    brand: 'CISSP Practice Diagnostic',
    title: 'Practice exam and domain diagnostic',
    unitName: 'domain',
    unitShort: 'D',
    types: ['knowledge', 'application', 'managerial_best_first_most'],
    examWeighted: true,
    managerialHint: true,
    inlineCode: false,
    exportTool: 'CISSP Practice Diagnostic (unofficial)',
    exportPrefix: 'cissp-diagnostic',
  },
  python: {
    id: 'python',
    label: 'Python',
    dataDir: 'data-python',
    storagePrefix: 'cissp-diagnostic:python',
    brand: 'Python Practice',
    title: 'Python practice from this site’s own code',
    unitName: 'topic',
    unitShort: 'T',
    types: ['knowledge', 'application'],
    examWeighted: false,
    managerialHint: false,
    inlineCode: true,
    exportTool: 'Python Practice (unofficial)',
    exportPrefix: 'python-practice',
  },
};

export function sanitizeTrack(value) {
  return typeof value === 'string' && Object.hasOwn(TRACKS, value) ? value : DEFAULT_TRACK;
}

export function loadTrack(storage = globalThis.localStorage) {
  try {
    return sanitizeTrack(storage.getItem(TRACK_KEY));
  } catch {
    return DEFAULT_TRACK;
  }
}

export function saveTrack(id, storage = globalThis.localStorage) {
  try {
    storage.setItem(TRACK_KEY, sanitizeTrack(id));
  } catch {
    // The choice lasts for this page view only.
  }
}

/** Storage keys for a track's saved session and review deck. */
export function trackKeys(id) {
  const prefix = TRACKS[sanitizeTrack(id)].storagePrefix;
  return { session: `${prefix}:session`, review: `${prefix}:review` };
}

/** Labels such as "D3 Security Architecture" or "T2 Regular expressions and formatting". */
export function unitLabel(id, number, name) {
  return `${TRACKS[sanitizeTrack(id)].unitShort}${number} ${name}`;
}
