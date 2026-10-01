import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, maxSessionLength, scoreSession, canSubmit } from '../lib/core.js';
import { loadJSON, taxonomy } from './fixtures.mjs';

test('the real bank loads from the manifest and supports a full session', () => {
  const manifest = loadJSON('data/manifest.json');
  const bank = manifest.batches.flatMap((b) => loadJSON(`data/${b.file}`));
  assert.ok(bank.length >= 20, 'bank must hold at least 20 questions');
  assert.equal(new Set(bank.map((q) => q.id)).size, bank.length);

  const lookup = new Map(bank.map((q) => [q.id, q]));
  const length = maxSessionLength(bank.length);
  const s = createSession(bank, taxonomy, { length, seed: 'real', bankVersion: manifest.bank_version });
  assert.equal(s.items.length, length);
  s.items.forEach((it) => { s.responses[it.id] = lookup.get(it.id).answer; });
  assert.ok(canSubmit(s));
  const r = scoreSession(s, lookup, taxonomy);
  assert.equal(r.overall.pct, 1);
});
