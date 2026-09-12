import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../visual/crt-viewport.js', import.meta.url), 'utf8')
  .replace(/^import .*shader-compilation.js';\n/m, '');
const flush = () => new Promise(resolve => setImmediate(resolve));
function viewport() {
  const counts = { contexts: 0, compilations: 0, draws: 0, errors: 0 };
  const frames = new Map();
  let complete, fail, frameId = 0;
  const gl = {
    createBuffer() { return {}; }, bindBuffer() {}, bufferData() {}, useProgram() {},
    getAttribLocation() { return 0; }, enableVertexAttribArray() {}, vertexAttribPointer() {},
    getUniformLocation(program, name) { return name; }, uniform1f() {}, viewport() {},
    clearColor() {}, clear() {}, drawArrays() { counts.draws++; },
  };
  const canvas = { style: {}, dataset: {}, width: 300, height: 150,
    getContext() { counts.contexts++; return gl; } };
  const events = {};
  let modeChanged, gameRunning = false;
  const window = { addEventListener(name, callback) { events[name] = callback; } };
  vm.runInNewContext(source, {
    MutationObserver: class { constructor(callback) { modeChanged = callback; } observe() {} },
    window, document: { getElementById: id => id === 'crt-viewport-canvas' ? canvas : null,
      body: { classList: { contains: () => gameRunning } } },
    location: { search: '?crt=off' }, URLSearchParams,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    matchMedia: () => ({ matches: false }), innerWidth: 800, innerHeight: 600,
    console: { error() { counts.errors++; } },
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    compileProgramAsync() {
      counts.compilations++;
      return new Promise((resolve, reject) => { complete = resolve; fail = reject; });
    },
  });
  return { api: window.__crtViewport, canvas, counts, frames, events,
    setGameRunning(value) { gameRunning = value; modeChanged(); },
    complete: () => complete({}), fail: () => fail(new Error('test shader failure')) };
}

test('disabled CRT initializes no WebGL, and turning it off during compilation keeps it hidden', async () => {
  const { api, canvas, counts, frames, complete } = viewport();
  assert.equal(counts.contexts, 0);
  assert.equal(counts.compilations, 0);
  assert.equal(canvas.hidden, true);
  api.enabled = true;
  assert.equal(counts.contexts, 1);
  assert.equal(counts.compilations, 1);
  assert.equal(canvas.hidden, true);
  assert.equal(frames.size, 0, 'no draw while compilation is pending');
  api.enabled = false;
  complete();
  await flush();
  assert.equal(canvas.dataset.crtState, 'ready');
  assert.equal(canvas.hidden, true);
  assert.equal(frames.size, 0);
  api.enabled = true;
  assert.equal(canvas.hidden, false);
  assert.equal(frames.size, 1);
  api.intensity = 0.4;
  assert.equal(counts.compilations, 1, 'settings and re-enable reuse the prepared program');
  const callback = frames.values().next().value;
  frames.clear(); callback(100);
  assert.equal(counts.draws, 1);
});

test('compilation failure preserves a usable page with the CRT hidden', async () => {
  const { api, canvas, counts, frames, fail } = viewport();
  api.enabled = true;
  fail();
  await flush();
  assert.equal(canvas.dataset.crtState, 'failed');
  assert.equal(canvas.hidden, true);
  assert.equal(frames.size, 0);
  assert.equal(counts.errors, 1);
  api.enabled = false;
  api.enabled = true;
  assert.equal(counts.compilations, 1, 'must not start a failure/retry loop');
});


test('gameplay freezes CRT without polling and mode/resize/settings wake it', async () => {
  const { api, canvas, counts, frames, complete, setGameRunning, events } = viewport();
  const draw = (time) => {
    const callbacks = [...frames.values()]; frames.clear();
    callbacks.forEach(callback => callback(time));
  };
  api.enabled = true; complete(); await flush();
  setGameRunning(true); draw(100);
  assert.equal(counts.draws, 1);
  assert.equal(canvas.style.backdropFilter, 'none');
  assert.equal(frames.size, 0, 'a frozen image must not poll every display frame');
  events.resize(); draw(200);
  assert.equal(counts.draws, 2);
  assert.equal(frames.size, 0);
  api.intensity = 0.4; draw(300);
  assert.equal(counts.draws, 3);
  assert.equal(frames.size, 0);
  setGameRunning(false); draw(400);
  assert.notEqual(canvas.style.backdropFilter, 'none');
  assert.equal(frames.size, 1, 'menu animation resumes after the game closes');
});
