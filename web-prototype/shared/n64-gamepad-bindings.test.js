import test from 'node:test';
import assert from 'node:assert/strict';
import {editableN64Profile,rebindN64Gamepad} from './n64-gamepad-bindings.js';
test('editing a calibrated standard profile preserves its axis overrides',()=>{
 const profile=editableN64Profile({mode:'standard',axes:{a:{index:4,value:1,neutral:0}}});
 assert.equal(profile.buttons.a,undefined);assert.equal(profile.axes.a.index,4);
});
test('rebinding buttons swaps conflicts, without changing the original profile',()=>{
 const original=editableN64Profile();const next=rebindN64Gamepad(original,'a',1);
 assert.equal(next.buttons.a,1);assert.equal(next.buttons.b,0);assert.equal(original.buttons.a,0);
});
test('reversing a stick direction swaps the opposing direction',()=>{
 const next=rebindN64Gamepad(editableN64Profile(),'up',{index:1,value:1,neutral:0});
 assert.equal(next.axes.up.value,1);assert.equal(next.axes.down.value,-1);
});
