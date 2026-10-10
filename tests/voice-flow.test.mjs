import test from 'node:test';
import assert from 'node:assert/strict';
import { step, initialFlow, MESSAGES, MAX_RETRIES } from '../lib/voice-flow.js';

const run = (flow, ...intents) => intents.reduce((acc, i) => {
  const r = step(acc.flow, i);
  return { flow: r.flow, effects: [...acc.effects, ...r.effects] };
}, { flow, effects: [] });

const says = (effects) => effects.filter((e) => e.do === 'say').map((e) => e.text);
const records = (effects) => effects.filter((e) => e.do === 'record').map((e) => e.letter);

test('a heard letter is confirmed aloud, not recorded', () => {
  const r = step(initialFlow(), { type: 'letter', letter: 'B' });
  assert.equal(r.flow.phase, 'confirming');
  assert.deepEqual(says(r.effects), ['You said B. Say yes to confirm, or say a different letter.']);
  assert.equal(r.effects[0].listen, true);
  assert.deepEqual(records(r.effects), []);
});

test('yes records the pending letter exactly once', () => {
  const r = run(initialFlow(), { type: 'letter', letter: 'C' }, { type: 'yes' });
  assert.deepEqual(records(r.effects), ['C']);
  assert.equal(r.flow.phase, 'answering');
  assert.equal(r.flow.letter, null);
});

test('saying the same letter again also confirms', () => {
  const r = run(initialFlow(), { type: 'letter', letter: 'D' }, { type: 'letter', letter: 'D' });
  assert.deepEqual(records(r.effects), ['D']);
});

test('a different letter replaces the pending one and asks again', () => {
  const r = run(initialFlow(), { type: 'letter', letter: 'A' }, { type: 'letter', letter: 'C' });
  assert.deepEqual(records(r.effects), []);
  assert.equal(r.flow.letter, 'C');
  assert.equal(says(r.effects).at(-1), MESSAGES.confirm('C'));
});

test('no or change discards the pending letter and listens again', () => {
  const r = run(initialFlow(), { type: 'letter', letter: 'A' }, { type: 'no' });
  assert.deepEqual(records(r.effects), []);
  assert.equal(r.flow.phase, 'answering');
  assert.equal(says(r.effects).at(-1), MESSAGES.which);
  assert.equal(r.effects.at(-1).listen, true);
});

test('yes or no with nothing pending is treated as not understood', () => {
  const r = step(initialFlow(), { type: 'yes' });
  assert.deepEqual(records(r.effects), []);
  assert.equal(says(r.effects)[0], MESSAGES.noCatch);
});

test('unrecognised speech retries twice, then falls back to tapping', () => {
  assert.equal(MAX_RETRIES, 2);
  let f = initialFlow();
  for (let i = 1; i <= MAX_RETRIES; i++) {
    const r = step(f, { type: 'none' });
    assert.equal(says(r.effects)[0], MESSAGES.noCatch);
    assert.equal(r.effects[0].listen, true, `retry ${i} listens again`);
    f = r.flow;
  }
  const last = step(f, { type: 'ambiguous' });
  assert.ok(last.effects.some((e) => e.do === 'fallback'));
  assert.ok(says(last.effects)[0].includes('tap'));
  assert.ok(last.effects.every((e) => e.listen !== true));
  assert.deepEqual(last.flow, initialFlow());
});

test('silence counts as a miss too', () => {
  const r = run(initialFlow(), { type: 'silence' }, { type: 'silence' }, { type: 'silence' });
  assert.ok(r.effects.some((e) => e.do === 'fallback'));
});

test('a miss while confirming keeps the pending letter and re-asks', () => {
  const r = run(initialFlow(), { type: 'letter', letter: 'B' }, { type: 'none' });
  assert.equal(r.flow.letter, 'B');
  assert.equal(says(r.effects).at(-1), MESSAGES.reprompt('B'));
});

test('three misses while confirming drop the pending letter without recording', () => {
  const r = run(initialFlow(), { type: 'letter', letter: 'B' }, { type: 'none' }, { type: 'none' }, { type: 'none' });
  assert.deepEqual(records(r.effects), []);
  assert.ok(r.effects.some((e) => e.do === 'fallback'));
  assert.equal(r.flow.letter, null);
});

test('a successful parse resets the retry counter', () => {
  const r = run(initialFlow(), { type: 'none' }, { type: 'none' }, { type: 'letter', letter: 'A' }, { type: 'none' });
  assert.equal(r.flow.retries, 1);
  assert.ok(!r.effects.some((e) => e.do === 'fallback'));
});

test('commands pass through and reset the flow', () => {
  const r = run(initialFlow(), { type: 'letter', letter: 'B' }, { type: 'command', name: 'skip' });
  assert.deepEqual(r.effects.at(-1), { do: 'command', name: 'skip' });
  assert.deepEqual(r.flow, initialFlow());
  assert.deepEqual(records(r.effects), []);
});

test('after saving, hands-free listens again but push-to-talk does not', () => {
  const r = run(initialFlow(), { type: 'letter', letter: 'B' }, { type: 'yes' });
  assert.equal(r.effects.at(-1).listen, 'handsfree');
});

test('no-correctness-leak: no message in the voice flow mentions correctness', () => {
  const banned = /\b(correct|incorrect|right|wrong|congrat\w*|well done|good job|nice|missed)\b/i;
  const texts = [];
  for (const [key, value] of Object.entries(MESSAGES)) {
    if (typeof value === 'function') for (const L of ['A', 'B', 'C', 'D']) texts.push([key, value(L)]);
    else texts.push([key, value]);
  }
  for (const [key, text] of texts) assert.ok(!banned.test(text), `MESSAGES.${key} mentions correctness: "${text}"`);
});

test('no-correctness-leak: every effect text comes from MESSAGES', () => {
  const allowed = new Set();
  for (const value of Object.values(MESSAGES)) {
    if (typeof value === 'function') for (const L of ['A', 'B', 'C', 'D']) allowed.add(value(L));
    else allowed.add(value);
  }
  const intents = [
    { type: 'letter', letter: 'A' }, { type: 'yes' }, { type: 'no' }, { type: 'none' }, { type: 'ambiguous' }, { type: 'silence' },
    { type: 'command', name: 'next' },
  ];
  for (const first of intents) {
    for (const second of intents) {
      for (const third of intents) {
        const r = run(initialFlow(), first, second, third);
        for (const text of says(r.effects)) assert.ok(allowed.has(text), `unexpected text: ${text}`);
      }
    }
  }
});

test('confirm off: a heard letter is recorded at once with nothing spoken', () => {
  const r = step(initialFlow(), { type: 'letter', letter: 'C' }, { confirm: false });
  assert.deepEqual(records(r.effects), ['C']);
  assert.deepEqual(says(r.effects), []);
  assert.deepEqual(r.effects.at(-1), { do: 'listen', when: 'handsfree' });
  assert.deepEqual(r.flow, initialFlow());
});
