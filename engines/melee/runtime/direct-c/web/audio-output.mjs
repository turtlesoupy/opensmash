/** Pitch-preserving playback that remains live while the game/GL worker stalls. */
export class RingStretcher {
 constructor(module,ring){
  const instance=new WebAssembly.Instance(module,{wasi_snapshot_preview1:{proc_exit:code=>{throw Error('Audio exited '+code);}}});this.api=instance.exports;this.api._initialize?.();
  if(!this.api.audio_create())throw Error('Cannot initialize audio playback');
  this.heap=new Float32Array(this.api.memory.buffer);this.input=this.api.audio_input()>>>2;this.output=this.api.audio_output()>>>2;
  this.indices=new Int32Array(ring,0,4);this.ring=new Float32Array(ring,16);this.capacity=this.ring.length/2;this.started=false;this.speed=1;this.target=6144;
 }
 process(left,right){
  left.fill(0);right.fill(0);const ix=this.indices,cap=this.capacity,write=Atomics.load(ix,0);let read=Atomics.load(ix,1),available=(write-read+cap)%cap;
  if(!this.started){if(available<this.target)return;this.started=true;}
  // Normal playback changes tempo gently. With little input left, react on the
  // audio clock immediately instead of waiting for the blocked producer.
  const low=available<this.target*.85;
  const desired=low?Math.max(.25,available/this.target*.6):Math.max(.85,Math.min(1.15,1+(available-this.target)/48000));
  this.speed=low?desired:this.speed*.9+desired*.1;this.api.audio_speed(this.speed);
  while(this.api.audio_available()<left.length&&available>0){
   const n=Math.min(256,available);
   for(let i=0;i<n;i++){this.heap[this.input+i*2]=this.ring[read*2];this.heap[this.input+i*2+1]=this.ring[read*2+1];read=(read+1)%cap;}
   available-=n;if(!this.api.audio_write(n))throw Error('Audio playback buffer exhausted');
  }
  Atomics.store(ix,1,read);const count=this.api.audio_read(left.length);
  for(let i=0;i<count;i++){left[i]=this.heap[this.output+i*2];right[i]=this.heap[this.output+i*2+1];}
  if(count<left.length)Atomics.add(ix,2,left.length-count);
  Atomics.add(ix,3,left.length);
 }
}
let compiled;
export async function createDirectAudioNode(audio,ring,workletReady){
 compiled??=fetch(new URL('./melee-audio.wasm',import.meta.url)).then(r=>{if(!r.ok)throw Error('Build the direct-C audio module');return r.arrayBuffer();}).then(b=>WebAssembly.compile(b));
 const module=await compiled;
 if(workletReady){
  let node;
  try{
   node=new AudioWorkletNode(audio,'melee-direct-audio',{numberOfInputs:0,numberOfOutputs:1,outputChannelCount:[2],processorOptions:{ring,module}});
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Audio processor did not initialize')),1500);
    node.port.onmessage=({data})=>{if(data?.type==='ready'){clearTimeout(timer);resolve();}};
    node.onprocessorerror=()=>{clearTimeout(timer);reject(Error('Audio processor could not initialize'));};
   });
   node.port.onmessage=null;return node;
  }catch(error){
   node?.disconnect();node?.port.close();
   console.warn('[Melee audio] Using main-thread playback:',error);
  }
 }
 const node=audio.createScriptProcessor(1024,0,2),playback=new RingStretcher(module,ring);
 node.onaudioprocess=e=>playback.process(e.outputBuffer.getChannelData(0),e.outputBuffer.getChannelData(1));return node;
}
