import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wilson, classify, canSubmit, answeredCount, submitThreshold, createSession, scoreSession,
  exportResults, emphasisRuns, LETTERS,
} from '../lib/core.js';
import { taxonomy, makeBank } from './fixtures.mjs';

const close = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('Wilson 95% interval matches reference values', () => {
  const [lo, hi] = wilson(8, 10);
  close(lo, 0.4902);
  close(hi, 0.9433);
  const [lo2, hi2] = wilson(0, 5);
  close(lo2, 0);
  close(hi2, 0.4345);
  const [lo3, hi3] = wilson(5, 5);
  close(lo3, 0.5655);
  close(hi3, 1);
  const [lo4, hi4] = wilson(50, 100);
  close(lo4, 0.4038);
  close(hi4, 0.5962);
  assert.equal(wilson(0, 0), null);
});

test('classification compares the CI to the 70% line and needs n >= 4', () => {
  assert.equal(classify(3, wilson(3, 3)), 'insufficient');
  assert.equal(classify(0, null), 'insufficient');
  assert.equal(classify(20, wilson(20, 20)), 'strength');
  assert.equal(classify(10, wilson(2, 10)), 'weakness');
  assert.equal(classify(10, wilson(7, 10)), 'adequate');
});

function sessionWith(bank, answeredN, length = 100) {
  const s = createSession(bank, taxonomy, { length, seed: 'gate', bankVersion: 't' });
  const lookup = new Map(bank.map((q) => [q.id, q]));
  s.items.slice(0, answeredN).forEach((it) => { s.responses[it.id] = lookup.get(it.id).answer; });
  return s;
}

test('submit gate: disabled at 19 answered, enabled at 20', () => {
  for (const size of [80, 250, 1000]) {
    const bank = makeBank(size);
    assert.equal(canSubmit(sessionWith(bank, 19)), false, `size ${size} at 19`);
    assert.equal(canSubmit(sessionWith(bank, 20)), true, `size ${size} at 20`);
    assert.equal(answeredCount(sessionWith(bank, 20)), 20);
  }
});

test('submit gate never exceeds the session length', () => {
  const s = sessionWith(makeBank(80), 0, 100);
  s.items = s.items.slice(0, 12);
  assert.equal(submitThreshold(s), 12);
  s.items.forEach((it) => { s.responses[it.id] = 'A'; });
  assert.equal(canSubmit(s), true);
});

test('scoring: raw, difficulty-weighted, and exam-weighted scores; unanswered excluded', () => {
  const bank = makeBank(1000);
  const lookup = new Map(bank.map((q) => [q.id, q]));
  const pick = (d, diff, k) => bank.filter((q) => q.domain === d && q.difficulty === diff).slice(0, k);
  const qs = [...pick(1, 'easy', 2), ...pick(1, 'hard', 2), ...pick(2, 'medium', 4), ...pick(3, 'easy', 1)];
  const session = {
    items: qs.map((q) => ({ id: q.id, perm: LETTERS.slice() })),
    responses: {},
    flagged: { [qs[8].id]: true },
    seed: 'x', bankVersion: 't', mode: 'standard', focusDomains: [],
  };
  const wrong = (q) => LETTERS.find((L) => L !== q.answer);
  // D1: easy right, easy wrong, hard right, hard right -> 3/4
  session.responses[qs[0].id] = qs[0].answer;
  session.responses[qs[1].id] = wrong(qs[1]);
  session.responses[qs[2].id] = qs[2].answer;
  session.responses[qs[3].id] = qs[3].answer;
  // D2: 1 of 4 medium right
  session.responses[qs[4].id] = qs[4].answer;
  for (const q of qs.slice(5, 8)) session.responses[q.id] = wrong(q);
  // D3 question left unanswered

  const r = scoreSession(session, lookup, taxonomy);
  assert.equal(r.answered, 8);
  assert.equal(r.unanswered.length, 1);
  assert.equal(r.overall.correct, 4);
  close(r.overall.pct, 0.5);
  // weights: D1 easy 1+1, hard 2+2 (correct 1+2+2=5 of 6); D2 medium 1.5*4 (correct 1.5 of 6)
  close(r.overall.weightedPct, (5 + 1.5) / 12);
  close(r.examWeighted, (0.16 * 0.75 + 0.1 * 0.25) / 0.26);
  assert.equal(r.domains[1].n, 4);
  close(r.domains[1].pct, 0.75);
  close(r.domains[1].weightedPct, 5 / 6);
  assert.equal(r.domains[3].n, 0);
  assert.equal(r.domains[3].status, 'insufficient');
  assert.equal(r.domains[2].status, 'weakness');
  assert.equal(r.byDifficulty.medium.n, 4);
  assert.equal(r.missed.length, 4);
  assert.deepEqual(r.weakDomains, ['2']);
  assert.ok(r.guidance[0].focus.length >= 2 && r.guidance[0].focus.length <= 3);
  assert.ok(r.guidance[0].missedSubtopics.length >= 1);

  const out = exportResults(session, r);
  assert.equal(out.items.length, 9);
  assert.equal(out.items.find((i) => i.id === qs[8].id).correct, null);
  assert.equal(out.items.find((i) => i.id === qs[8].id).flagged, true);
  assert.equal(out.scores.raw_pct, 0.5);
});

test('emphasis markers become strong runs without HTML', () => {
  assert.deepEqual(emphasisRuns('Which is **NOT** a <b>control</b>?'), [
    { text: 'Which is ', strong: false },
    { text: 'NOT', strong: true },
    { text: ' a <b>control</b>?', strong: false },
  ]);
});
