import test from 'node:test';import assert from 'node:assert/strict';
import {samplePad,samplePorts} from './input.mjs';
test('native N64 consumes the remapped browser layout and preserves device identity after reconnect',()=>{
 const pad={index:4,id:'pad',connected:true,axes:[1,0,0,-1],buttons:Array.from({length:16},(_,i)=>({pressed:i===0,value:i===0?1:0}))};
 assert.deepEqual(samplePad(pad),[3,1,0x8008,80,0,0,0,0,0]);
 const plan=[{kind:'gamepad',index:0,id:'pad'},{kind:'keyboard'},{kind:'none'},null];
 assert.equal(samplePorts(plan,[pad])[0][2],0x8008);assert.equal(samplePorts(plan,[pad])[1][0],2);
 assert.equal(samplePorts(plan,[{...pad,id:'other'}])[0][1],0);
 assert.equal(samplePorts(plan,[pad],true)[0][2],0);
});

test('embedded keyboard preserves N64 buttons and opposite directions cancel',async()=>{
 const {sampleKeyboard}=await import('./input.mjs');
 assert.deepEqual(sampleKeyboard(new Set(['Enter','KeyJ','KeyW','KeyD'])),[2,1,0x9000,80,80,0,0,0,0]);
 assert.deepEqual(sampleKeyboard(new Set(['KeyW','KeyS','ArrowLeft','ArrowRight'])),[2,1,0,0,0,0,0,0,0]);
});
