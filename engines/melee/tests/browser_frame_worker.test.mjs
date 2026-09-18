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

test('Safari mounts directly in the final parent without reloading the iframe',async()=>{
 const saved={document:globalThis.document,window:globalThis.window,location:globalThis.location,ResizeObserver:globalThis.ResizeObserver};
 const sent=[];let insertions=0;
 const parent={clientWidth:480,clientHeight:360,insertBefore(frame){insertions++;frame.parentElement=this;}};
 const surface={parentElement:parent,style:{}};
 const frame={style:{},contentWindow:{postMessage:data=>sent.push(data)},setAttribute(){},remove(){}};
 Object.assign(globalThis,{document:{createElement:()=>frame,body:{append(){throw Error('must mount in game panel');}}},window:new EventTarget(),location:{origin:'http://localhost',search:''},ResizeObserver:class{observe(){}disconnect(){}}});
 try{
  const {MeleeFrameWorker}=await import('../web/lib/melee-frame-worker.ts');
  const worker=new MeleeFrameWorker('/engine',surface);worker.connected=true;worker.attachSurface(surface);
  assert.equal(insertions,1);assert.equal(surface.style.opacity,'0');
  assert.equal(frame.style.transform,'scale(0.5)');assert.deepEqual(sent,[{type:'surface',direct:true}]);
  const audio=new SharedArrayBuffer(64);worker.postMessage({type:'start',audio});
  assert.equal(frame.contentWindow.openSmashAudioRing,audio,'same-origin handoff preserves the shared ring even when window messages copy it');
  worker.terminate();assert.equal(surface.style.opacity,'');
 }finally{Object.assign(globalThis,saved);}
});

test('empty engine errors retain GPU diagnostics and always have visible text',async()=>{
 const saved={document:globalThis.document,window:globalThis.window,location:globalThis.location};
 const frame={style:{},contentWindow:{postMessage(){}},remove(){}};
 Object.assign(globalThis,{document:{createElement:()=>frame,body:{append(){}}},window:new EventTarget(),location:{origin:'http://localhost'}});
 try{
  const {MeleeFrameWorker}=await import('../web/lib/melee-frame-worker.ts');
  const worker=new MeleeFrameWorker('/engine');
  let received;worker.onmessage=event=>received=event.data;
  const emit=data=>worker.listener({source:frame.contentWindow,origin:location.origin,data});
  emit({type:'error',message:''});
  assert.match(received.message,/initialization failed/);
  emit({type:'log',text:'WebGPU not available (requestAdapter returned null)'});
  emit({type:'log',text:'[aurora] Error creating window: Aborted()'});
  emit({type:'error',message:''});
  assert.match(received.message,/Check browser hardware acceleration/);
  assert.match(received.message,/requestAdapter returned null/);
  assert.match(received.message,/Aborted/);
  worker.terminate();
 }finally{Object.assign(globalThis,saved);}
});

test('a missing engine bridge reports a startup failure',async()=>{
 const saved={document:globalThis.document,window:globalThis.window,location:globalThis.location,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
 let timeout,cleared=false;
 const frame={style:{},contentWindow:{postMessage(){}},remove(){}};
 Object.assign(globalThis,{document:{createElement:()=>frame,body:{append(){}}},window:new EventTarget(),location:{origin:'http://localhost'},setTimeout:callback=>{timeout=callback;return 1;},clearTimeout:()=>{cleared=true;}});
 try{
  const {MeleeFrameWorker}=await import('../web/lib/melee-frame-worker.ts');
  const worker=new MeleeFrameWorker('/missing-engine');
  let received;worker.onmessage=event=>received=event.data;
  timeout();assert.equal(received.type,'error');assert.match(received.message,/did not initialize/);
  worker.terminate();assert.equal(cleared,true);
 }finally{Object.assign(globalThis,saved);}
});
