// Confirmation state machine for voice answers. Pure: (flow, intent) -> { flow, effects }.
// It never sees question data, so it cannot say or show whether an answer is correct.

export const MAX_RETRIES = 2;

// Everything the app may say or show from voice lives here, so one test can check the wording.
export const MESSAGES = {
  confirm: (letter) => `You said ${letter}. Say yes to confirm, or say a different letter.`,
  reprompt: (letter) => `I didn't catch that. Say yes to confirm ${letter}, or say a different letter.`,
  noCatch: "I didn't catch that.",
  fallback: "I didn't catch that. Please tap your answer.",
  which: 'Okay. Which option?',
  saved: (letter) => `Saved ${letter}. Say next to continue.`,
  flagged: 'Flagged for review.',
  unflagged: 'Flag removed.',
  firstQuestion: 'This is the first question.',
  lastQuestion: 'This is the last question.',
  confirmOnScreen: 'Please choose on screen whether to submit.',
  stopped: 'Voice listening is off.',
  tapToTalk: 'Voice paused for this question. Tap an answer, or press V to talk.',
  enabled: 'Voice answers are on. Press V or the Talk button, then say A, B, C, or D.',
  denied: 'Microphone access was blocked, so voice answers are off. You can still tap or type your answers. To use voice, allow the microphone for this site in your browser settings, then enable voice again.',
  noMic: 'No microphone was found, so voice answers are off. You can still tap or type your answers.',
  network: 'The speech service could not be reached, so voice answers are off. You can still tap or type your answers.',
  unavailable: 'Voice recognition stopped working in this browser. You can still tap or type your answers.',
  needTap: 'This browser needs a tap to start the microphone. Press the Talk button when you are ready.',
  waiting: 'Waiting for microphone permission. Choose Allow if your browser asks.',
};

export const initialFlow = () => ({ phase: 'answering', letter: null, retries: 0 });

const say = (text, listen = false) => ({ do: 'say', text, listen });

function miss(flow) {
  const retries = flow.retries + 1;
  if (retries > MAX_RETRIES) {
    return { flow: initialFlow(), effects: [say(MESSAGES.fallback), { do: 'fallback' }] };
  }
  const text = flow.phase === 'confirming' ? MESSAGES.reprompt(flow.letter) : MESSAGES.noCatch;
  return { flow: { ...flow, retries }, effects: [say(text, true)] };
}

const askToConfirm = (letter) => ({
  flow: { phase: 'confirming', letter, retries: 0 },
  effects: [say(MESSAGES.confirm(letter), true)],
});

// intent: { type: 'letter' | 'command' | 'yes' | 'no' | 'ambiguous' | 'none' | 'silence', letter?, name? }
// listen: true listens after the speech ends; 'handsfree' listens only when hands-free is on.
// options.confirm false skips the read-back: a heard letter is recorded at once and nothing is spoken.
export function step(flow, intent, { confirm = true } = {}) {
  const fresh = initialFlow();
  switch (intent.type) {
    case 'letter':
      if (!confirm) return { flow: fresh, effects: [{ do: 'record', letter: intent.letter }, { do: 'listen', when: 'handsfree' }] };
      if (flow.phase === 'confirming' && intent.letter === flow.letter) {
        return { flow: fresh, effects: [{ do: 'record', letter: flow.letter }, say(MESSAGES.saved(flow.letter), 'handsfree')] };
      }
      return askToConfirm(intent.letter);
    case 'yes':
      if (flow.phase !== 'confirming') return miss(flow);
      return { flow: fresh, effects: [{ do: 'record', letter: flow.letter }, say(MESSAGES.saved(flow.letter), 'handsfree')] };
    case 'no':
      if (flow.phase !== 'confirming') return miss(flow);
      return { flow: fresh, effects: [say(MESSAGES.which, true)] };
    case 'command':
      return { flow: fresh, effects: [{ do: 'command', name: intent.name }] };
    default:
      return miss(flow);
  }
}
