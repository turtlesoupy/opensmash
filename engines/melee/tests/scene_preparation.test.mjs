import assert from 'node:assert/strict';
import {test} from 'node:test';
import {sceneReady} from '../runtime/web/scene-preparation.mjs';

test('holds cold stalls until a complete stable window replaces them',()=>{
 const frames=[7310,2479,3164,897,806];
 for(let i=0;i<29;i++){frames.push(16.7);assert.equal(sceneReady(frames),false);}
 frames.push(16.7);assert.equal(sceneReady(frames),true);
});
test('does not hand over a slow renderer or incomplete timing data',()=>{
 for(const frame of [25,40,0,NaN,Infinity])assert.equal(sceneReady(Array(30).fill(frame)),false);
 assert.equal(sceneReady(Array(29).fill(16)),false);
 assert.equal(sceneReady([...Array(29).fill(1),500]),false);
});
