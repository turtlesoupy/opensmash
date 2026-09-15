import test from 'node:test';
import assert from 'node:assert/strict';
import {meleePath} from '../web/lib/paths.ts';
test('Melee namespaces API and engine assets while leaving other origins and site routes intact',()=>{
 const previous=globalThis.location;
 try {
  globalThis.location={pathname:'/melee'};
  assert.equal(meleePath('/api/prepare/a?target=fox'),'/melee/api/prepare/a?target=fox');
  assert.equal(meleePath('/engine/audio-worklet.js'),'/melee/engine/audio-worklet.js');
  assert.equal(meleePath('/melee/api/costume/a'),'/melee/api/costume/a');
  assert.equal(meleePath('https://assets.example/a'),'https://assets.example/a');
  assert.equal(meleePath('/create'),'/create');
  globalThis.location={pathname:'/'};assert.equal(meleePath('/api/native/launch'),'/api/native/launch');
 }finally{globalThis.location=previous;}
});
