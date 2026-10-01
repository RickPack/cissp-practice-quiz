import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocate, sampleQuestions, domainWeights, focusWeights, mulberry32, seedFromString,
  createSession, maxSessionLength,
} from '../lib/core.js';
import { taxonomy, makeBank, countBy } from './fixtures.mjs';

const weights = domainWeights(taxonomy);
const mix = taxonomy.difficulty_mix;
const rngFor = (s) => mulberry32(seedFromString(String(s)));

test('allocate sums exactly and respects caps', () => {
  assert.deepEqual(allocate(100, weights), { 1: 16, 2: 10, 3: 13, 4: 13, 5: 13, 6: 12, 7: 13, 8: 10 });
  const capped = allocate(100, weights, { 1: 5, 2: 100, 3: 100, 4: 100, 5: 100, 6: 100, 7: 100, 8: 100 });
  assert.equal(capped[1], 5);
  assert.equal(Object.values(capped).reduce((a, b) => a + b, 0), 100);
  const tiny = allocate(100, weights, { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2 });
  assert.equal(Object.values(tiny).reduce((a, b) => a + b, 0), 16);
});

for (const size of [80, 250, 1000]) {
  test(`bank of ${size}: max session draws unique questions proportional to domain weights`, () => {
    const bank = makeBank(size);
    const n = maxSessionLength(size);
    const drawn = sampleQuestions(bank, n, { weights, mix, rng: rngFor(size) });
    assert.equal(drawn.length, n);
    assert.equal(new Set(drawn.map((q) => q.id)).size, n, 'no question drawn twice');
    const perDomain = countBy(drawn, (q) => String(q.domain));
    const available = countBy(bank, (q) => String(q.domain));
    const expected = allocate(n, weights, available);
    for (const d of Object.keys(weights)) assert.equal(perDomain[d] || 0, expected[d], `domain ${d}`);
  });

  test(`bank of ${size}: difficulty mix inside each domain follows 30/45/25`, () => {
    const bank = makeBank(size);
    const drawn = sampleQuestions(bank, maxSessionLength(size), { weights, mix, rng: rngFor(`d${size}`) });
    for (const d of Object.keys(weights)) {
      const inDomain = drawn.filter((q) => String(q.domain) === d);
      const got = countBy(inDomain, (q) => q.difficulty);
      const caps = countBy(bank.filter((q) => String(q.domain) === d), (q) => q.difficulty);
      const want = allocate(inDomain.length, mix, caps);
      for (const k of Object.keys(mix)) assert.equal(got[k] || 0, want[k], `domain ${d} ${k}`);
    }
  });

  test(`bank of ${size}: minimum session of 20 works`, () => {
    const drawn = sampleQuestions(makeBank(size), 20, { weights, mix, rng: rngFor('min') });
    assert.equal(drawn.length, 20);
  });
}

test('1,000-question bank: a 100-question draw matches the exam weights exactly', () => {
  const drawn = sampleQuestions(makeBank(1000), 100, { weights, mix, rng: rngFor('exact') });
  assert.deepEqual(countBy(drawn, (q) => String(q.domain)), { 1: 16, 2: 10, 3: 13, 4: 13, 5: 13, 6: 12, 7: 13, 8: 10 });
});

test('asking for more than the bank holds returns the whole bank', () => {
  const bank = makeBank(80);
  const drawn = sampleQuestions(bank, 100, { weights, mix, rng: rngFor('all') });
  assert.equal(drawn.length, 80);
});

test('short domain: takes what exists and redistributes the rest proportionally', () => {
  const full = makeBank(1000);
  const bank = full.filter((q) => q.domain !== 2 || Number(q.id.slice(3)) <= 3);
  const drawn = sampleQuestions(bank, 100, { weights, mix, rng: rngFor('short') });
  const perDomain = countBy(drawn, (q) => String(q.domain));
  assert.equal(drawn.length, 100);
  assert.equal(perDomain[2], 3);
  for (const d of ['1', '3', '4', '5', '6', '7', '8']) {
    assert.ok(perDomain[d] >= allocate(100, weights)[d], `domain ${d} absorbs part of the shortfall`);
  }
});

test('missing difficulty stratum: the domain quota is still met from other strata', () => {
  const bank = makeBank(1000).filter((q) => !(q.domain === 1 && q.difficulty === 'hard'));
  const drawn = sampleQuestions(bank, 100, { weights, mix, rng: rngFor('nohard') });
  const d1 = drawn.filter((q) => q.domain === 1);
  assert.equal(d1.length, 16);
  assert.equal(d1.filter((q) => q.difficulty === 'hard').length, 0);
});

test('empty domain: its slots go to other domains', () => {
  const bank = makeBank(250).filter((q) => q.domain !== 8);
  const drawn = sampleQuestions(bank, 100, { weights, mix, rng: rngFor('empty') });
  assert.equal(drawn.length, 100);
  assert.equal(drawn.filter((q) => q.domain === 8).length, 0);
});

test('same seed reproduces the session; a different seed does not', () => {
  const bank = makeBank(1000);
  const a = createSession(bank, taxonomy, { length: 50, seed: 'abc', bankVersion: 't' });
  const b = createSession(bank, taxonomy, { length: 50, seed: 'abc', bankVersion: 't' });
  const c = createSession(bank, taxonomy, { length: 50, seed: 'abd', bankVersion: 't' });
  assert.deepEqual(a.items, b.items);
  assert.notDeepEqual(a.items.map((x) => x.id), c.items.map((x) => x.id));
});

for (const size of [500, 1000]) {
  test(`simulation: 1,000 sessions of 100 from a ${size}-question bank stay within ±3 points per domain`, () => {
    const bank = makeBank(size);
    const totals = {};
    const seen = new Set();
    for (let s = 0; s < 1000; s++) {
      const drawn = sampleQuestions(bank, 100, { weights, mix, rng: rngFor(`sim${size}-${s}`) });
      for (const q of drawn) {
        totals[q.domain] = (totals[q.domain] || 0) + 1;
        seen.add(q.id);
      }
    }
    for (const [d, w] of Object.entries(weights)) {
      const share = totals[d] / 100000;
      assert.ok(Math.abs(share - w) <= 0.03, `domain ${d}: ${share.toFixed(3)} vs ${w}`);
    }
    assert.equal(seen.size, size, 'every question is eventually drawn');
  });
}

test('focus weights give weak domains 60% of the session', () => {
  const fw = focusWeights(weights, ['2', '8']);
  assert.ok(Math.abs(fw[2] + fw[8] - 0.6) < 1e-9);
  const drawn = sampleQuestions(makeBank(1000), 100, { weights: fw, mix, rng: rngFor('focus') });
  const perDomain = countBy(drawn, (q) => String(q.domain));
  assert.equal(perDomain[2] + perDomain[8], 60);
  assert.deepEqual(focusWeights(weights, Object.keys(weights)), weights, 'all weak falls back to exam weights');
});
