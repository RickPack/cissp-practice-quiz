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

test('the app\'s commute code never touches the quiz session or the report', () => {
  const start = app.indexOf('// ---------- Commute mode ----------');
  const end = app.indexOf('// ---------- Wiring ----------');
  assert.ok(start > 0 && end > start, 'commute section found');
  const block = app.slice(start, end);
  assert.ok(!/storage\.(save|clear)|state\.session|state\.report|scoreSession|showReport|startSession|finish\(\)/.test(block));
});

test('the track toggle is only on the start screen', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const start = html.slice(html.indexOf('<section id="start"'), html.indexOf('<section id="quiz"'));
  const rest = html.slice(html.indexOf('<section id="quiz"'));
  assert.equal((start.match(/name="track"/g) || []).length, 2);
  assert.ok(!/name="track"/.test(rest));
});

test('the CISSP wording the track chrome writes matches the original page text', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const pick = (name) => app.match(new RegExp(`const ${name} = ["'](.+?)["'];`))[1];
  assert.ok(html.includes(`>${pick('CISSP_SAMPLING')}<`), 'sampling hint');
  assert.ok(html.includes(`>${pick('CISSP_TYPE_SUB')}<`), 'type chart caption');
});

test('code is shown as text, never as HTML', () => {
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(app));
  assert.match(app, /\$\('code-text'\)\.textContent = q\.code/);
});

test('commute mode is reached only from the start screen and only with speech output', () => {
  assert.match(app, /function setupCommute\(\) \{\s*if \(!speech\) return;/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const startScreen = html.slice(html.indexOf('<section id="start"'), html.indexOf('<section id="quiz"'));
  assert.match(startScreen, /id="commute-open"/);
  const quiz = html.slice(html.indexOf('<section id="quiz"'), html.indexOf('<section id="report"'));
  assert.ok(!/commute/.test(quiz), 'no commute entry inside the quiz');
});

test('headphone buttons: silence.wav is cached offline and allowed by the CSP, and the buttons start from the Start tap', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes("'silence.wav'"), 'sw.js SHELL is missing silence.wav');
  assert.match(read('index.html'), /default-src 'self'/); // media falls back to default-src, so no blob: or data: is needed
  assert.match(app, /function startCommute\(\)[\s\S]*?mediaKeys\?\.start\(\);[\s\S]*?commute\.start\(/);
  assert.match(app, /phase === 'done' \|\| phase === 'idle'\) mediaKeys\?\.stop\(\)/);
});
