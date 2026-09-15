import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Script} from 'node:vm';
import {frameRates} from '../../engines/melee/runtime/web/frame-rates.mjs';

test('the runtime remains valid as the classic worker used by the website', () => {
  const source=readFileSync(new URL('../../engines/melee/runtime/web/engine-worker.js',import.meta.url),'utf8');
  assert.doesNotThrow(()=>new Script(source));
});

test('rendering at 60 FPS cannot hide a slower match', () => {
  assert.deepEqual(frameRates(1800,1200,30000),{renderFps:60,combatFps:40,fps:40});
});

test('a match advancing at full speed cannot hide slow rendering', () => {
  assert.deepEqual(frameRates(1200,1800,30000),{renderFps:40,combatFps:60,fps:40});
});

test('stopped, restarted and invalid-duration intervals do not claim gameplay FPS', () => {
  assert.equal(frameRates(60,0,1000).fps,0);
  assert.equal(frameRates(60,-100,1000).fps,0);
  assert.equal(frameRates(60,60,0).fps,0);
  assert.equal(frameRates(60,60,Infinity).fps,0);
  assert.equal(frameRates(60,60,1000).fps,60);
});
