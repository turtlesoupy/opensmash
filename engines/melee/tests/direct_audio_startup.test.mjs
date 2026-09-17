import test from 'node:test';
import assert from 'node:assert/strict';

for(const outcome of ['ready','processor-error','clone-error'])test(`direct audio handles ${outcome}`,async()=>{
 const saved={fetch:globalThis.fetch,WebAssembly:globalThis.WebAssembly,AudioWorkletNode:globalThis.AudioWorkletNode};
 let disconnected=false,closed=false;
 globalThis.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});
 globalThis.WebAssembly={compile:async()=>({}),Instance:class{exports={memory:{buffer:new ArrayBuffer(4096)},audio_create:()=>1,audio_input:()=>0,audio_output:()=>2048};}};
 globalThis.AudioWorkletNode=class{
  port={close(){closed=true;}};
  constructor(){if(outcome==='clone-error')throw new DOMException('Cannot clone WASM module','DataCloneError');queueMicrotask(()=>outcome==='ready'?this.port.onmessage({data:{type:'ready'}}):this.onprocessorerror());}
  disconnect(){disconnected=true;}
 };
 const fallback={};const audio={createScriptProcessor:()=>fallback};
 try{
  const {createDirectAudioNode}=await import(`../runtime/direct-c/web/audio-output.mjs?test=${outcome}`);
  const node=await createDirectAudioNode(audio,new SharedArrayBuffer(16+8192*8),true);
  if(outcome==='ready'){assert.ok(node instanceof AudioWorkletNode);assert.equal(disconnected,false);}
  else{assert.equal(node,fallback);assert.equal(typeof node.onaudioprocess,'function');if(outcome==='processor-error'){assert.equal(disconnected,true);assert.equal(closed,true);}}
 }finally{Object.assign(globalThis,saved);}
});
