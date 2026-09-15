import test from 'node:test';
import assert from 'node:assert/strict';
import {discDockPose, DISC_DOCK_MS, DISC_SEATED_MS} from '../../engines/melee/launcher/disc-motion.js';

test('disc seats before the lid closes and stays seated during retreat', () => {
  for(let ms=0;ms<=DISC_DOCK_MS;ms+=5){
    const p=discDockPose(ms);
    assert.ok(p.height>=0 && p.height<=.58);
    assert.ok(p.lid>=0 && p.lid<=1);
    if(p.lid<1) assert.equal(p.height,0);
    if(p.retreat>0) assert.equal(p.lid,0);
  }
  assert.equal(discDockPose(DISC_SEATED_MS).height,0);
  assert.equal(discDockPose(DISC_DOCK_MS).retreat,1);
});

test('disc motion has no position or velocity jump at phase boundaries', () => {
  for(const ms of [1220,1870,1920,2570,2790,2890,3440,3510,4300]){
    for(const field of ['height','spin','lid','retreat']){
      const a=discDockPose(ms-.1)[field],b=discDockPose(ms)[field],c=discDockPose(ms+.1)[field];
      assert.ok(Math.abs((c-b)-(b-a))<1e-6,`${field} jumps at ${ms}`);
    }
  }
});
