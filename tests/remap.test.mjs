import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LETTERS, makePermutation, viewQuestion, displayLetterFor, originalLetterFor, mulberry32,
} from '../lib/core.js';
import { makeBank } from './fixtures.mjs';

test('shuffled options keep the correct text under the remapped letter', () => {
  const rng = mulberry32(42);
  const bank = makeBank(80);
  const shownAt = { A: 0, B: 0, C: 0, D: 0 };
  for (let round = 0; round < 50; round++) {
    for (const q of bank) {
      const perm = makePermutation(rng);
      assert.deepEqual([...perm].sort(), LETTERS, 'permutation of A-D');
      const view = viewQuestion(q, perm);
      const correctOption = view.options.find((o) => o.letter === view.correct);
      assert.equal(correctOption.text, q.options[q.answer]);
      assert.equal(originalLetterFor(perm, view.correct), q.answer);
      assert.equal(displayLetterFor(perm, q.answer), view.correct);
      shownAt[view.correct]++;
    }
  }
  for (const L of LETTERS) assert.ok(Math.abs(shownAt[L] / 4000 - 0.25) < 0.03, `correct shown at ${L}: ${shownAt[L]}`);
});

test('distractor rationales follow their options through the shuffle', () => {
  const [q] = makeBank(80);
  const perm = ['C', 'A', 'D', 'B'];
  const view = viewQuestion(q, perm);
  assert.deepEqual(view.options.map((o) => o.original), perm);
  assert.equal(Object.keys(view.rationales).length, 3);
  assert.ok(!(view.correct in view.rationales));
  for (const [display, text] of Object.entries(view.rationales)) {
    assert.equal(text, q.distractor_rationales[originalLetterFor(perm, display)]);
  }
});
