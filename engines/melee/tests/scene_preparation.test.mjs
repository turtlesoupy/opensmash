import test from 'node:test';
import assert from 'node:assert/strict';
import {sceneReady} from '../runtime/web/scene-preparation.mjs';

test('requires a full window of settled frames after a loading stall',()=>{
 const frames=[500];
 for(let i=0;i<29;i++){frames.push(16.7);assert.equal(sceneReady(frames),false);}
 frames.push(16.7);assert.equal(sceneReady(frames),true);
});
test('allows steady mobile rendering below 60 FPS',()=>{
 for(const ms of [16.7,25,33.3,40,50])assert.equal(sceneReady(Array(30).fill(ms)),true);
});
test('rejects invalid timings, sustained stalls, and intermittent shader hitches',()=>{
 for(const frame of [101,0,NaN,Infinity])assert.equal(sceneReady(Array(30).fill(frame)),false);
 assert.equal(sceneReady(Array(29).fill(16)),false);
 assert.equal(sceneReady([...Array(29).fill(1),500]),false);
 assert.equal(sceneReady([...Array(29).fill(40),90]),false);
 assert.equal(sceneReady([...Array(29).fill(16),40]),false);
});
