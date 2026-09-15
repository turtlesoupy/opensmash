import {meleePath} from './paths.ts';
let enabled=true;
let gain:GainNode|undefined;
export function setAudioEnabled(value:boolean){enabled=value;if(gain)gain.gain.value=enabled?1:0;}
let context:AudioContext|undefined;
let workletReady:Promise<boolean>|undefined;
export async function unlockAudio(){
 context??=new AudioContext({sampleRate:48000,latencyHint:'interactive'});
 void context.resume();
 // Some browser/audio-device combinations leave addModule pending indefinitely.
 // Bound initialization so a functioning audio device can still play the game.
 workletReady??=Promise.race([
  context.audioWorklet.addModule(meleePath(new URLSearchParams(location.search).get('engine')==='direct-c'?'/engine/direct-c/audio-worklet.mjs':'/engine/audio-worklet.js')).then(()=>true,()=>false),
  new Promise<boolean>(resolve=>setTimeout(()=>resolve(false),1000)),
 ]);
 await workletReady;return context;
}
function fallbackAudio(audio:AudioContext,ring:SharedArrayBuffer){
 const node=audio.createScriptProcessor(1024,0,2),indices=new Int32Array(ring,0,4),samples=new Float32Array(ring,16),capacity=samples.length/2;
 let primed=false,started=false;
 node.onaudioprocess=event=>{
  const left=event.outputBuffer.getChannelData(0),right=event.outputBuffer.getChannelData(1);
  left.fill(0);right.fill(0);
  let read=Atomics.load(indices,1);const write=Atomics.load(indices,0);
  if(!primed){if((write-read+capacity)%capacity<3072){if(started)Atomics.add(indices,2,left.length);return;}primed=true;started=true;}
  for(let i=0;i<left.length;i++){
   if(read===write){Atomics.add(indices,2,left.length-i);primed=false;break;}
   left[i]=samples[read*2];right[i]=samples[read*2+1];read=(read+1)%capacity;
  }
  Atomics.store(indices,1,read);Atomics.add(indices,3,left.length);
 };
 return node;
}
export async function connectAudio(ring:SharedArrayBuffer):Promise<AudioNode>{
 const audio=await unlockAudio();
 const direct=new URLSearchParams(location.search).get('engine')==='direct-c';
 const node=direct?await (await import(/* @vite-ignore */ meleePath('/engine/direct-c/audio-output.mjs'))).createDirectAudioNode(audio,ring,await workletReady):await workletReady?new AudioWorkletNode(audio,'melee-audio',{outputChannelCount:[2],processorOptions:{ring}}):fallbackAudio(audio,ring);
 gain??=audio.createGain();gain.gain.value=enabled?1:0;gain.disconnect();gain.connect(audio.destination);node.connect(gain);
 return node;
}
