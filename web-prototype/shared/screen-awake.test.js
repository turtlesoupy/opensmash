import test from 'node:test';
import assert from 'node:assert/strict';
import {holdScreenAwake} from './screen-awake.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const document = new EventTarget(); document.visibilityState = 'visible';
  const locks = []; let requests = 0;
  const wakeLock = {async request(type) {
    assert.equal(type, 'screen'); requests++;
    const lock = new EventTarget(); lock.released = false;
    lock.release = async () => { lock.released = true; lock.dispatchEvent(new Event('release')); };
    locks.push(lock); return lock;
  }};
  return {document, wakeLock, locks, get requests() {return requests;}};
}
test('reacquires after returning to the page, avoids duplicate locks, and releases on exit', async () => {
  const f = fixture(), release = holdScreenAwake(f);
  f.document.dispatchEvent(new Event('visibilitychange')); await tick();
  assert.equal(f.requests, 1);
  f.document.visibilityState = 'hidden'; await f.locks[0].release();
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange')); await tick();
  assert.equal(f.requests, 2);
  release(); assert.equal(f.locks[1].released, true);
  f.document.dispatchEvent(new Event('visibilitychange')); await tick(); assert.equal(f.requests, 2);
});
test('a pending request cannot leave the screen locked awake after exit', async () => {
  const f = fixture(); let resolve;
  const release = holdScreenAwake({document:f.document, wakeLock:{request:()=>new Promise(r=>{resolve=r;})}});
  release(); const lock=await f.wakeLock.request('screen'); resolve(lock); await tick();
  assert.equal(lock.released, true);
});
test('unsupported or denied wake locks do not block a game', async () => {
  holdScreenAwake({document:null,wakeLock:null})();
  const f=fixture(); const release=holdScreenAwake({document:f.document,wakeLock:{request:async()=>{throw Error('denied');}}});
  await tick(); release();
});
