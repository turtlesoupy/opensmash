import test from 'node:test';
import assert from 'node:assert/strict';

test('iframe transport sends input changes, preserves releases, and resends after confirm',async()=>{
 const saved={document:globalThis.document,window:globalThis.window,location:globalThis.location};
 const sent=[];
 const frame={style:{},contentWindow:{postMessage:data=>sent.push(structuredClone(data))},remove(){}};
 Object.assign(globalThis,{document:{createElement:()=>frame,body:{append(){}}},window:new EventTarget(),location:{origin:'http://localhost'}});
 try{
  const {MeleeFrameWorker}=await import('../web/lib/melee-frame-worker.ts');
  const worker=new MeleeFrameWorker('/engine');worker.connected=true;
  const neutral=[0,0,0x80808080,0,1],held=[0,256,0x80808080,0,1];
  for(const values of [neutral,neutral,held,held,neutral])worker.postMessage({type:'pad',values});
  assert.deepEqual(sent.map(m=>m.values),[neutral,held,neutral]);
  worker.postMessage({type:'confirm'});worker.postMessage({type:'pad',values:neutral});
  assert.equal(sent.length,5,'confirmation cannot prevent subsequent neutral state');
  worker.postMessage({type:'pad',values:[1,0,0x80808080,0,0]});
  assert.equal(sent.length,6,'ports retain independent state');
  worker.terminate();worker.postMessage({type:'pad',values:held});assert.equal(sent.length,6);
 }finally{Object.assign(globalThis,saved);}
});
