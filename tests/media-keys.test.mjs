import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMediaKeys, isSupported, BUTTONS } from '../lib/media-keys.js';

function harness({ playRejects = false } = {}) {
  const handlersSet = {};
  const mediaSession = {
    playbackState: 'none',
    metadata: null,
    setActionHandler(action, fn) { handlersSet[action] = fn; },
  };
  const audio = {
    loop: false, playing: false, plays: 0,
    play() { audio.plays += 1; audio.playing = true; return playRejects ? Promise.reject(new Error('blocked')) : Promise.resolve(); },
    pause() { audio.playing = false; },
  };
  const calls = [];
  const handlers = { next: () => calls.push('next'), repeat: () => calls.push('repeat'), pause: () => calls.push('pause'), resume: () => calls.push('resume') };
  class Metadata { constructor(init) { Object.assign(this, init); } }
  const keys = createMediaKeys({ audio, mediaSession, Metadata, handlers });
  return { keys, audio, mediaSession, handlersSet, calls };
}

test('the buttons map to exactly next, repeat, pause, and resume', () => {
  assert.deepEqual(BUTTONS, { nexttrack: 'next', previoustrack: 'repeat', pause: 'pause', play: 'resume' });
});

test('start plays the silent loop, sets the lock-screen card, and registers all four buttons', () => {
  const h = harness();
  assert.equal(h.keys.start(), true);
  assert.equal(h.audio.loop, true);
  assert.equal(h.audio.playing, true);
  assert.equal(h.mediaSession.playbackState, 'playing');
  assert.equal(h.mediaSession.metadata.title, 'Commute mode');
  assert.deepEqual(Object.keys(h.handlersSet).sort(), ['nexttrack', 'pause', 'play', 'previoustrack']);
});

test('each button reaches its handler, and pause/play update the lock-screen state', () => {
  const h = harness();
  h.keys.start();
  h.handlersSet.nexttrack();
  h.handlersSet.previoustrack();
  h.handlersSet.pause();
  assert.equal(h.mediaSession.playbackState, 'paused');
  h.handlersSet.play();
  assert.equal(h.mediaSession.playbackState, 'playing');
  assert.deepEqual(h.calls, ['next', 'repeat', 'pause', 'resume']);
});

test('start twice plays once; stop pauses the audio and removes every handler', () => {
  const h = harness();
  h.keys.start();
  assert.equal(h.keys.start(), false);
  assert.equal(h.audio.plays, 1);
  assert.equal(h.keys.stop(), true);
  assert.equal(h.audio.playing, false);
  assert.equal(h.mediaSession.playbackState, 'none');
  assert.deepEqual(Object.values(h.handlersSet), [null, null, null, null]);
  assert.equal(h.keys.stop(), false);
});

test('a button pressed after stop does nothing', () => {
  const h = harness();
  h.keys.start();
  const next = h.handlersSet.nexttrack;
  h.keys.stop();
  next();
  assert.deepEqual(h.calls, []);
});

test('a blocked audio play does not throw', async () => {
  const h = harness({ playRejects: true });
  assert.doesNotThrow(() => h.keys.start());
  await new Promise((r) => setImmediate(r));
});

test('a browser without Media Session is reported as unsupported', () => {
  assert.equal(isSupported({}), false);
  assert.equal(isSupported({ navigator: {}, Audio: class {} }), false);
  assert.equal(isSupported({ navigator: { mediaSession: {} }, Audio: class {} }), true);
});

test('the module takes no question or answer data', () => {
  const src = readFileSync(new URL('../lib/media-keys.js', import.meta.url), 'utf8');
  assert.ok(!/import /.test(src));
  assert.ok(!/answer|stem|explanation/i.test(src.replace(/\/\/.*$/gm, '')));
});
