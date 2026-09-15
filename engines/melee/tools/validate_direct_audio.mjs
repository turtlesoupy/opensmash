/** Deterministic independent-audio-clock stress test, including a 200 ms game stall. */
import fs from 'node:fs';
import {RingStretcher} from '../runtime/direct-c/web/audio-output.mjs';
const module=await WebAssembly.compile(fs.readFileSync(new URL('../build/direct-c/melee-audio.wasm',import.meta.url)));
const results=[];
for(const quantum of [128,1024]){
 const ring=new SharedArrayBuffer(16+32768*8),ix=new Int32Array(ring,0,4),pcm=new Float32Array(ring,16),playback=new RingStretcher(module,ring),left=new Float32Array(quantum),right=new Float32Array(quantum);
 let produced=0,overruns=0;const recording=[[],[]];
 for(let clock=0;clock<48000*8;clock+=quantum){
  if(!(clock>=48000&&clock<57600)){
   const until=Math.floor(clock/800)*800+800;
   while(produced<until){const w=Atomics.load(ix,0),next=(w+1)%32768;if(next===Atomics.load(ix,1))overruns++;else{pcm[w*2]=.5*Math.sin(2*Math.PI*440*produced/48000);pcm[w*2+1]=.5*Math.sin(2*Math.PI*660*produced/48000);Atomics.store(ix,0,next);}produced++;}
  }
  playback.process(left,right);if(clock>=48000*.5&&clock<48000*2.5){recording[0].push(...left);recording[1].push(...right);}
 }
 const frequencies=recording.map(a=>{let crossings=0;for(let i=1;i<a.length;i++)if(a[i-1]<0&&a[i]>=0)crossings++;return crossings*48000/a.length;});
 const rms=recording.map(a=>Math.sqrt(a.reduce((sum,x)=>sum+x*x,0)/a.length));
 const queuedMs=((ix[0]-ix[1]+32768)%32768)/48;
 const result={quantum,stallMs:200,queuedMs,overruns,underruns:ix[2],rendered:ix[3],frequencies,rms};results.push(result);
}
console.log(JSON.stringify(results,null,2));
if(results.some(r=>r.overruns||r.underruns||r.queuedMs>250||r.rms.some(x=>x<.1)||Math.abs(r.frequencies[0]-440)>2||Math.abs(r.frequencies[1]-660)>2))process.exitCode=1;
