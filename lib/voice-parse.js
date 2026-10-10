// Turns what the speech recogniser heard into an intent. Pure functions, no DOM, no speech APIs.
// To teach it a new spoken form, add a word to one of the tables below and add a test case.

export const LETTERS = ['A', 'B', 'C', 'D'];

// Words that always mean a letter, including common mis-hearings of the letter names.
export const LETTER_ALIASES = {
  A: ['a', 'ay', 'eh', 'ah', 'hey', 'alpha', 'alfa', 'first', '1st'],
  B: ['b', 'bee', 'be', 'bravo', 'second', '2nd'],
  C: ['c', 'see', 'sea', 'cee', 'charlie', 'third', '3rd'],
  D: ['d', 'dee', 'delta', 'fourth', '4th', 'forth', 'last'],
};

// Numbers count only when spoken alone ("two") or after a context word ("option 2", "number two").
export const NUMBER_ALIASES = {
  A: ['1', 'one'],
  B: ['2', 'two'],
  C: ['3', 'three'],
  D: ['4', 'four'],
};

// Homophones of numbers. Too risky on their own, so they count only after a context word.
export const CONTEXT_ONLY_ALIASES = {
  B: ['to', 'too'],
  D: ['for', 'fore'],
};

export const CONTEXT_WORDS = ['option', 'choice', 'number', 'letter', 'answer', 'response', 'pick', 'select', 'choose'];

// Words that join two candidates ("b or c"). Two different letters around one become "ambiguous".
export const CONNECTORS = ['or', 'and', 'either', 'versus'];

// Ordinals can be followed by "one" ("the second one"); that trailing number is not a second answer.
const ORDINALS = ['first', 'second', 'third', 'fourth', '1st', '2nd', '3rd', '4th', 'last'];

// Spoken padding that is removed before matching. Multi-word phrases are matched before single words.
export const FILLER_PHRASES = [
  'my final answer is', 'my final answer', 'my answer would be', 'my answer is', 'the answer would be',
  'the answer is', 'answer is', 'i think it is', "i think it's", 'i think its', 'i think', 'i believe',
  'i guess', 'i would say', "i'd say", 'id say', "i'll go with", 'ill go with', 'i will go with',
  "let's go with", 'lets go with', 'going with', 'go with', 'would be', 'is it',
];
export const FILLER_WORDS = [
  'um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'hm', 'well', 'so', 'like', 'please', 'the', 'is', 'it',
  "it's", 'its', "that's", 'thats', 'that', 'maybe', 'probably', 'definitely', 'just', 'i',
];

// Whole-utterance voice commands. Phrases are compared after filler is stripped.
export const COMMANDS = {
  next: ['next', 'next question', 'go next', 'go to next', 'forward', 'continue'],
  previous: ['previous', 'previous question', 'back', 'go back', 'go to previous'],
  repeat: ['repeat', 'repeat that', 'repeat question', 'again', 'read again', 'read it again', 'say again', 'read question'],
  flag: ['flag', 'flag this', 'flag question', 'flag for review', 'unflag', 'mark for review', 'bookmark'],
  skip: ['skip', 'skip this', 'skip question', 'pass'],
  stop: ['stop', 'stop listening', 'stop voice', 'stop mic', 'mic off', 'turn off', 'cancel'],
  submit: ['submit', 'finish', 'submit exam', 'submit quiz', 'finish exam', 'submit and finish'],
};

export const CONFIRM_YES = ['yes', 'yeah', 'yep', 'yup', 'confirm', 'confirmed', 'correct', 'right', 'ok', 'okay', 'sure', 'affirmative'];
export const CONFIRM_NO = ['no', 'nope', 'change', 'change it', 'wrong', 'redo', 'different', 'not that'];

// While a letter is waiting for confirmation, only these commands are honoured.
const CONFIRM_PHASE_COMMANDS = ['skip', 'stop'];

const MAX_TOKENS = 4;
const AMBIGUITY_RATIO = 1.5;
const DEFAULT_CONFIDENCE = 0.5;
const INTERIM_WEIGHT = 0.6;
const RANK_DECAY = 0.25;

const toLookup = (table) => {
  const map = new Map();
  for (const [letter, words] of Object.entries(table)) for (const w of words) map.set(w, letter);
  return map;
};
const LETTER_LOOKUP = toLookup(LETTER_ALIASES);
const NUMBER_LOOKUP = toLookup(NUMBER_ALIASES);
const CONTEXT_ONLY_LOOKUP = toLookup(CONTEXT_ONLY_ALIASES);
const CONTEXT_SET = new Set(CONTEXT_WORDS);
const CONNECTOR_SET = new Set(CONNECTORS);
const ORDINAL_SET = new Set(ORDINALS);
const FILLER_WORD_SET = new Set(FILLER_WORDS);
const PHRASES = FILLER_PHRASES.map((p) => p.split(' ')).sort((a, b) => b.length - a.length);

export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns the tokens left after spoken padding is removed.
export function stripFiller(text) {
  const tokens = normalize(text).split(' ').filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; ) {
    const phrase = PHRASES.find((p) => p.every((w, k) => tokens[i + k] === w));
    if (phrase) {
      i += phrase.length;
    } else if (FILLER_WORD_SET.has(tokens[i])) {
      i += 1;
    } else {
      out.push(tokens[i++]);
    }
  }
  return out;
}

// "B as in boy", "d for dog", "C like cat": the first letter of the clarifying word counts too.
// Add other lead-in phrases here.
export const SPELLING_LEAD_INS = ['as in', 'as a', 'as for', 'is for', 'for', 'like'];
const SPELLING_TAIL = new RegExp(`^(.*?)\\b(?:${SPELLING_LEAD_INS.join('|')})\\s+(?:the\\s+|a\\s+)?([a-z]+)$`);

function parseSpelled(text) {
  const m = SPELLING_TAIL.exec(normalize(text));
  if (!m) return null;
  const head = parseSingle(m[1]);
  const initial = m[2][0].toUpperCase();
  const fromWord = LETTERS.includes(initial) ? initial : null;
  if (head.status === 'ambiguous') return head;
  if (head.status === 'match') {
    if (!fromWord || fromWord === head.letter) return head;
    return { status: 'ambiguous', letter: null };
  }
  return fromWord ? { status: 'match', letter: fromWord } : null;
}

// One transcript to one result: { status: 'match' | 'ambiguous' | 'none', letter }.
export function parseSingle(text) {
  const spelled = parseSpelled(text);
  if (spelled) return spelled;
  const tokens = stripFiller(text);
  if (!tokens.length || tokens.length > MAX_TOKENS) return { status: 'none', letter: null };
  const content = tokens.filter((t) => !CONTEXT_SET.has(t) && !CONNECTOR_SET.has(t));
  const found = new Set();
  let context = false;
  let afterOrdinal = false;
  let unknown = 0;
  for (const t of tokens) {
    if (CONTEXT_SET.has(t)) {
      context = true;
      afterOrdinal = false;
    } else if (CONNECTOR_SET.has(t)) {
      afterOrdinal = false;
    } else if (LETTER_LOOKUP.has(t)) {
      found.add(LETTER_LOOKUP.get(t));
      afterOrdinal = ORDINAL_SET.has(t);
    } else if (NUMBER_LOOKUP.has(t) && (context || content.length === 1)) {
      found.add(NUMBER_LOOKUP.get(t));
      afterOrdinal = false;
    } else if (NUMBER_LOOKUP.has(t) && afterOrdinal) {
      afterOrdinal = false;
    } else if (CONTEXT_ONLY_LOOKUP.has(t) && context) {
      found.add(CONTEXT_ONLY_LOOKUP.get(t));
      afterOrdinal = false;
    } else {
      unknown += 1;
    }
  }
  if (unknown || !found.size) return { status: 'none', letter: null };
  if (found.size > 1) return { status: 'ambiguous', letter: null };
  return { status: 'match', letter: [...found][0] };
}

// Accepts strings or { transcript, confidence, interim }. Final alternatives keep the order the engine gave.
export function toAlternatives(list) {
  return (list || [])
    .map((a) => (typeof a === 'string' ? { transcript: a } : a))
    .filter((a) => a && typeof a.transcript === 'string' && a.transcript.trim());
}

// Votes across every alternative, weighting by confidence, rank, and whether the text was interim.
// If the top alternative is itself ambiguous, or the leading letter does not clearly win, the answer is ambiguous.
export function parseAnswer(list) {
  const alts = toAlternatives(list);
  const scores = new Map();
  let rank = 0;
  let topStatus = null;
  for (const alt of alts) {
    const r = parseSingle(alt.transcript);
    if (!alt.interim && topStatus === null) topStatus = r.status;
    if (r.status === 'match') {
      const conf = alt.confidence > 0 ? alt.confidence : DEFAULT_CONFIDENCE;
      const weight = (conf * (alt.interim ? INTERIM_WEIGHT : 1)) / (1 + RANK_DECAY * rank);
      scores.set(r.letter, (scores.get(r.letter) || 0) + weight);
    }
    if (!alt.interim) rank += 1;
  }
  if (topStatus === 'ambiguous') return { status: 'ambiguous', letter: null, alternatives: alts };
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return { status: 'none', letter: null, alternatives: alts };
  if (ranked.length > 1 && ranked[0][1] < ranked[1][1] * AMBIGUITY_RATIO) {
    return { status: 'ambiguous', letter: null, alternatives: alts };
  }
  return { status: 'match', letter: ranked[0][0], alternatives: alts };
}

const joined = (text) => stripFiller(text).join(' ');

export function matchCommand(text, allowed = Object.keys(COMMANDS)) {
  const phrase = joined(text);
  if (!phrase) return null;
  return allowed.find((name) => COMMANDS[name].includes(phrase)) || null;
}

export function matchConfirm(text) {
  const phrase = normalize(text).replace(/^(yes|yeah|yep) (please|sure)$/, '$1');
  if (CONFIRM_YES.includes(phrase)) return 'yes';
  if (CONFIRM_NO.includes(phrase)) return 'no';
  return null;
}

// The single entry point the controller uses.
// phase 'answering': letters and commands. phase 'confirming': yes / no / a letter / skip / stop.
// Returns { type: 'letter' | 'command' | 'yes' | 'no' | 'ambiguous' | 'none', letter?, name?, heard }.
export function interpret(list, phase = 'answering') {
  const alts = toAlternatives(list);
  const finals = alts.filter((a) => !a.interim);
  const heard = (finals[0] || alts[0] || { transcript: '' }).transcript.trim();
  const allowed = phase === 'confirming' ? CONFIRM_PHASE_COMMANDS : Object.keys(COMMANDS);

  const nonLetter = (text) => {
    const name = matchCommand(text, allowed);
    if (name) return { type: 'command', name, heard };
    if (phase === 'confirming') {
      const c = matchConfirm(text);
      if (c) return { type: c, heard };
    }
    return null;
  };

  const top = finals[0] ? nonLetter(finals[0].transcript) : null;
  if (top) return top;

  const answer = parseAnswer(alts);
  if (answer.status === 'match') return { type: 'letter', letter: answer.letter, heard };
  if (answer.status === 'ambiguous') return { type: 'ambiguous', heard };

  for (const alt of finals.slice(1)) {
    const hit = nonLetter(alt.transcript);
    if (hit) return hit;
  }
  return { type: 'none', heard };
}
