import assert from 'node:assert/strict';
import fs from 'node:fs';
import {worldMatrices,multiply,identity,hsdMatrixBuilder,cameraMatrix} from '../web/matrices.mjs';
const root=new URL('../../',import.meta.url);
const e=(await WebAssembly.instantiate(fs.readFileSync(new URL('build/browser-port/runtime/melee-animation.wasm',root)))).instance.exports;
const build=hsdMatrixBuilder(e);
const data=JSON.parse(fs.readFileSync(new URL('build/browser-port/runtime/mario-local.json',root)));
const bind=data.skeleton.flatMap(j=>[...j.rotation,...j.position,...j.scale]);
const worlds=worldMatrices(data.skeleton,bind,build);
let bindResidual=0,formulaError=0;
for(let i=0;i<worlds.length;i++)if(data.skeleton[i].inverse_bind){
 const product=multiply(worlds[i],data.skeleton[i].inverse_bind.flat());
 for(let k=0;k<16;k++)bindResidual=Math.max(bindResidual,Math.abs(product[k]-identity()[k]));
}
assert.ok(bindResidual<3e-5,`Archived inverse-bind identity residual ${bindResidual}`);
// Independent double-precision equations versus original HSD float arithmetic.
// Include nonuniform parent scales and negative handedness, which ordinary TRS misses.
let seed=42;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
for(let i=0;i<1000;i++){
 const skeleton=[{parent:null,flags:0},{parent:0,flags:i%2?8:0}];
 const pose=[];
 for(let j=0;j<2;j++)pose.push(...Array.from({length:3},()=>random()*6-3),...Array.from({length:3},()=>random()*20-10),...Array.from({length:3},()=>((random()*2+.25)*(random()<.5?-1:1))));
 const ref=worldMatrices(skeleton,pose),actual=worldMatrices(skeleton,pose,build);
 for(let j=0;j<2;j++)for(let k=0;k<16;k++)formulaError=Math.max(formulaError,Math.abs(ref[j][k]-actual[j][k]));
}
assert.ok(formulaError<2e-5,`HSD scale compensation mismatch ${formulaError}`);
console.log(JSON.stringify({bindResidual,formulaError,randomized_cases:1000}));

// Camera depth must be orthogonal to screen X; a sign error collapses depth
// at 45 degrees, producing severe z-fighting despite correct skinning.
for(const view of ['front','side','three']){
 const c=cameraMatrix(view),right=[c[0]*14,c[4]*14,c[8]*14],depth=[c[2]*100,c[6]*100,c[10]*100];
 assert.ok(Math.abs(right.reduce((s,x,i)=>s+x*depth[i],0))<1e-6);
 assert.ok(Math.abs(Math.hypot(...right)-1)<1e-6);
 assert.ok(Math.abs(Math.hypot(...depth)-1)<1e-6);
 assert.ok(depth[0]<=0 && depth[2]<=0,'Front/right surfaces should be closer');
}
