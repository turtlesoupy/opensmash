import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRenderWidth,resolveRenderWidth} from '../web/lib/render-resolution.mjs';
test('automatic resolution budgets mobile and low-memory devices without using DPR',()=>{
 assert.equal(resolveRenderWidth(0,{userAgent:'Android',deviceMemory:8}),640);
 assert.equal(resolveRenderWidth(0,{userAgent:'Macintosh',maxTouchPoints:5}),640);
 assert.equal(resolveRenderWidth(0,{userAgent:'Windows',deviceMemory:4}),640);
 assert.equal(resolveRenderWidth(0,{userAgent:'Macintosh',maxTouchPoints:0,deviceMemory:8}),960);
 assert.equal(resolveRenderWidth(0,{}),960);
});
test('explicit resolution overrides automatic selection and invalid saved values fall back',()=>{
 assert.equal(resolveRenderWidth(1920,{userAgent:'Android'}),1920);
 assert.equal(resolveRenderWidth(640,{userAgent:'Windows',deviceMemory:16}),640);
 for(const value of [null,undefined,-1,999999,800,'1920',NaN,Infinity])assert.equal(normalizeRenderWidth(value),0);
});
