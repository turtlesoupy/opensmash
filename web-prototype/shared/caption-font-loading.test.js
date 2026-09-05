import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCaptionFonts } from './caption-font-loading.js';

test('captions wait until all three cuts are loaded', async () => {
  const pending = [];
  const result = loadCaptionFonts({ load: () => new Promise(resolve => pending.push(resolve)) });
  assert.equal(pending.length, 3);
  let settled = false;
  void result.then(() => { settled = true; });
  pending[0]([{}]); pending[1]([{}]);
  await Promise.resolve();
  assert.equal(settled, false);
  pending[2]([{}]);
  assert.equal(await result, 'ready');
});

test('missing or failed fonts show fallback', async () => {
  assert.equal(await loadCaptionFonts(null), 'fallback');
  assert.equal(await loadCaptionFonts({ load: async () => [] }), 'fallback');
  assert.equal(await loadCaptionFonts({ load: async () => { throw new Error('Network error'); } }), 'fallback');
});

test('timeout shows fallback and late completion cannot swap it', async () => {
  const pending = [];
  const result = loadCaptionFonts({ load: () => new Promise(resolve => pending.push(resolve)) }, 5);
  assert.equal(await result, 'fallback');
  pending.forEach(resolve => resolve([{}]));
  assert.equal(await result, 'fallback');
});
