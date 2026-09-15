import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('audio primes silently, then preserves stereo samples and counts real underruns',()=>{
 let Processor;
 vm.runInNewContext(readFileSync(new URL('../runtime/web/audio-worklet.js',import.meta.url),'utf8'),{
  AudioWorkletProcessor:class {},registerProcessor:(name,ctor)=>Processor=ctor,
  Int32Array,Float32Array,Atomics});
 const ring=new SharedArrayBuffer(16+8192*2*4),indices=new Int32Array(ring,0,4),samples=new Float32Array(ring,16);
 const processor=new Processor({processorOptions:{ring}});
 const out=()=>[[new Float32Array(128),new Float32Array(128)]];
 let output=out();processor.process([],output);
 assert.equal(indices[2],0);assert.equal(indices[3],0);
 assert.equal(output[0][0].every(x=>x===0),true);
 for(let i=0;i<1024;i++){samples[i*2]=.25;samples[i*2+1]=-.5;}
 Atomics.store(indices,0,1024);output=out();processor.process([],output);
 assert.equal(output[0][0].every(x=>x===.25),true);
 assert.equal(output[0][1].every(x=>x===-.5),true);
 assert.equal(indices[1],128);assert.equal(indices[3],128);
 for(let i=0;i<8;i++)processor.process([],out());
 assert.equal(indices[2],128); // Only the ninth block runs out of real audio.
});
