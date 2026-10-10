import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LETTER_ALIASES, NUMBER_ALIASES, normalize, stripFiller, parseSingle, parseAnswer, matchCommand, matchConfirm, interpret,
} from '../lib/voice-parse.js';

const letterOf = (text) => parseSingle(text).letter;

test('plain letters and punctuation', () => {
  for (const L of ['A', 'B', 'C', 'D']) {
    assert.equal(letterOf(L), L);
    assert.equal(letterOf(`${L.toLowerCase()}.`), L);
    assert.equal(letterOf(`Option ${L}`), L);
  }
});

test('homophones and mis-hearings of letter names', () => {
  assert.equal(letterOf('bee'), 'B');
  assert.equal(letterOf('be'), 'B');
  assert.equal(letterOf('dee'), 'D');
  assert.equal(letterOf('see'), 'C');
  assert.equal(letterOf('sea'), 'C');
  assert.equal(letterOf('cee'), 'C');
  assert.equal(letterOf('hey'), 'A');
});

test('phonetic alphabet, ordinals, and numbered options', () => {
  assert.deepEqual(['alpha', 'bravo', 'charlie', 'delta'].map(letterOf), ['A', 'B', 'C', 'D']);
  assert.deepEqual(['first', 'second', 'third', 'fourth'].map(letterOf), ['A', 'B', 'C', 'D']);
  assert.deepEqual(['option 1', 'option 2', 'option 3', 'option 4'].map(letterOf), ['A', 'B', 'C', 'D']);
  assert.deepEqual(['number one', 'number two', 'number three', 'number four'].map(letterOf), ['A', 'B', 'C', 'D']);
  assert.equal(letterOf('the second one'), 'B');
  assert.equal(letterOf('the last one'), 'D');
  assert.equal(letterOf('two'), 'B');
  assert.equal(letterOf('4'), 'D');
});

test('number homophones count only after a context word', () => {
  assert.equal(letterOf('option for'), 'D');
  assert.equal(letterOf('choice too'), 'B');
  assert.equal(letterOf('for'), null);
  assert.equal(letterOf('to'), null);
});

test('filler and lead-ins are ignored', () => {
  assert.equal(letterOf('um I think it is B'), 'B');
  assert.equal(letterOf('my answer is charlie'), 'C');
  assert.equal(letterOf("I'd say option two"), 'B');
  assert.equal(letterOf('uh, let’s go with delta please'), 'D');
  assert.deepEqual(stripFiller('Um... my answer is B'), ['b']);
  assert.equal(normalize('  It’s   B! '), "it's b");
});

test('ambiguous input is flagged, not guessed', () => {
  assert.equal(parseSingle('b or c').status, 'ambiguous');
  assert.equal(parseSingle('a and d').status, 'ambiguous');
  assert.equal(parseSingle('first or second').status, 'ambiguous');
  assert.equal(parseSingle('b').status, 'match');
});

test('unrecognised or long speech gives no letter', () => {
  assert.equal(parseSingle('').status, 'none');
  assert.equal(parseSingle('banana').status, 'none');
  assert.equal(parseSingle('um').status, 'none');
  assert.equal(parseSingle('option').status, 'none');
  assert.equal(parseSingle('I really cannot decide between these answers').status, 'none');
});

test('alternatives: a lower-ranked alternative rescues a mis-hearing', () => {
  const r = parseAnswer([{ transcript: 'bean', confidence: 0.4 }, { transcript: 'bee', confidence: 0.3 }, { transcript: 'b', confidence: 0.2 }]);
  assert.equal(r.status, 'match');
  assert.equal(r.letter, 'B');
});

test('alternatives: confidence and rank pick the best letter', () => {
  const r = parseAnswer([{ transcript: 'see', confidence: 0.9 }, { transcript: 'bee', confidence: 0.2 }]);
  assert.equal(r.letter, 'C');
});

test('alternatives: a near tie is ambiguous', () => {
  const r = parseAnswer([{ transcript: 'see', confidence: 0.5 }, { transcript: 'bee', confidence: 0.45 }]);
  assert.equal(r.status, 'ambiguous');
});

test('alternatives: an ambiguous top transcript stays ambiguous', () => {
  const r = parseAnswer([{ transcript: 'b or c', confidence: 0.9 }, { transcript: 'b', confidence: 0.8 }]);
  assert.equal(r.status, 'ambiguous');
});

test('interim text helps when the final transcript is garbled', () => {
  const r = parseAnswer([{ transcript: 'beam', confidence: 0.5 }, { transcript: 'bee', interim: true, confidence: 0.5 }]);
  assert.equal(r.letter, 'B');
});

test('plain strings are accepted as alternatives', () => {
  assert.equal(parseAnswer(['charlie']).letter, 'C');
  assert.equal(parseAnswer([]).status, 'none');
});

test('commands', () => {
  assert.equal(matchCommand('next'), 'next');
  assert.equal(matchCommand('Next question.'), 'next');
  assert.equal(matchCommand('go back'), 'previous');
  assert.equal(matchCommand('please repeat'), 'repeat');
  assert.equal(matchCommand('flag this'), 'flag');
  assert.equal(matchCommand('skip'), 'skip');
  assert.equal(matchCommand('stop listening'), 'stop');
  assert.equal(matchCommand('submit'), 'submit');
  assert.equal(matchCommand('banana'), null);
  assert.equal(matchCommand('submit', ['skip', 'stop']), null);
});

test('confirmation words', () => {
  for (const w of ['yes', 'Yeah', 'confirm', 'correct', 'yes please']) assert.equal(matchConfirm(w), 'yes', w);
  for (const w of ['no', 'change', 'nope']) assert.equal(matchConfirm(w), 'no', w);
  assert.equal(matchConfirm('maybe'), null);
});

test('interpret in the answering phase', () => {
  assert.deepEqual(interpret(['bee']), { type: 'letter', letter: 'B', heard: 'bee' });
  assert.equal(interpret(['next']).name, 'next');
  assert.equal(interpret(['b or c']).type, 'ambiguous');
  assert.equal(interpret(['banana']).type, 'none');
  assert.equal(interpret(['yes']).type, 'none');
});

test('interpret in the confirming phase', () => {
  assert.equal(interpret(['yes'], 'confirming').type, 'yes');
  assert.equal(interpret(['no'], 'confirming').type, 'no');
  assert.equal(interpret(['dee'], 'confirming').letter, 'D');
  assert.equal(interpret(['skip'], 'confirming').name, 'skip');
  assert.equal(interpret(['stop listening'], 'confirming').name, 'stop');
  // Navigation and submit are not honoured while a letter awaits confirmation.
  assert.equal(interpret(['next'], 'confirming').type, 'none');
  assert.equal(interpret(['submit'], 'confirming').type, 'none');
});

test('alias tables cover every letter and have no word in two places', () => {
  const seen = new Map();
  for (const table of [LETTER_ALIASES, NUMBER_ALIASES]) {
    assert.deepEqual(Object.keys(table), ['A', 'B', 'C', 'D']);
    for (const [letter, words] of Object.entries(table)) {
      for (const w of words) {
        assert.ok(!seen.has(w) || seen.get(w) === letter, `alias "${w}" maps to two letters`);
        seen.set(w, letter);
      }
    }
  }
});

test('"as in" spelling: the first letter of the clarifying word counts', () => {
  assert.equal(letterOf('Answer B as in boy'), 'B');
  assert.equal(letterOf('d as in dog'), 'D');
  assert.equal(letterOf('C for Charlie'), 'C');
  assert.equal(letterOf('answer a like apple'), 'A');
  assert.equal(letterOf('bee as in the boy'), 'B');
});

test('"as in": the word rescues a letter that was mis-heard', () => {
  assert.equal(letterOf('the as in dog'), 'D');
  assert.equal(letterOf('answer as in charlie'), 'C');
});

test('"as in": a clashing letter and word is ambiguous, not guessed', () => {
  assert.equal(parseSingle('b as in dog').status, 'ambiguous');
});

test('"as in" with a word starting outside A-D keeps the spoken letter', () => {
  assert.equal(letterOf('b as in xylophone'), 'B');
  assert.equal(parseSingle('as in xylophone').status, 'none');
});

test('"as in" works through interpret', () => {
  assert.deepEqual(interpret(['Answer B as in boy']), { type: 'letter', letter: 'B', heard: 'Answer B as in boy' });
});

test('"for" after a context word is still a number, not a spelling', () => {
  assert.equal(letterOf('option for'), 'D');
});
