// Static checks on how app.js and sw.js are wired. The DOM paths are covered by browser runs; these guard the rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const app = read('app.js');

test('the offline cache lists every module in lib/', () => {
  const sw = read('sw.js');
  for (const file of readdirSync(new URL('../lib/', import.meta.url)).filter((f) => f.endsWith('.js'))) {
    assert.ok(sw.includes(`'lib/${file}'`), `sw.js SHELL is missing lib/${file}`);
  }
});

test('the review deck is updated only when a session is submitted, never when a report is reopened', () => {
  assert.equal(app.match(/showReport\([^)]*updateDeck: true/g)?.length, 1);
  assert.match(app, /function finish\(\)[\s\S]*?showReport\(s, \{ updateDeck: true \}\)/);
  assert.match(app, /if \(saved\) showReport\(saved\);/);
});

test('review sessions are built without the sampler and scored with the usual scorer', () => {
  const block = app.slice(app.indexOf('function startReview'), app.indexOf('// Called once, when a session is submitted.'));
  assert.ok(block.length > 50);
  assert.match(block, /createReviewSession\(/);
  assert.ok(!/sampleQuestions|createSession\(/.test(block));
});
