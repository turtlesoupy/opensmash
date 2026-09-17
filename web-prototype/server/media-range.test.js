import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaRange } from './media-range.js';

test('Safari probe, seeking, suffix and oversized ranges', () => {
  assert.deepEqual(mediaRange('bytes=0-1', 100), {start:0,end:1});
  assert.deepEqual(mediaRange('bytes=40-', 100), {start:40,end:99});
  assert.deepEqual(mediaRange('bytes=-20', 100), {start:80,end:99});
  assert.deepEqual(mediaRange('bytes=-200', 100), {start:0,end:99});
  assert.deepEqual(mediaRange('bytes=40-200', 100), {start:40,end:99});
});
test('unsatisfiable ranges and malformed ranges are distinguished', () => {
  for (const [value,size] of [['bytes=100-',100],['bytes=-0',100],['bytes=0-1',0]]) {
    assert.deepEqual(mediaRange(value,size), {unsatisfiable:true});
  }
  for (const value of [undefined,'bytes=-','bytes=20-10','bytes=0-1,4-5','items=0-1']) {
    assert.equal(mediaRange(value,100),null);
  }
});
