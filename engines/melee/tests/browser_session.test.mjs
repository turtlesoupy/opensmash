import test from 'node:test';
import assert from 'node:assert/strict';

test('disc pickers share verification, replacement cancels old setup, and replay reuses the verified File', async()=>{
 const previous={Worker:globalThis.Worker,location:globalThis.location,crossOriginIsolated:globalThis.crossOriginIsolated};
 const workers=[];
 class Worker extends EventTarget {
  constructor(){super();workers.push(this);}
  postMessage(message){this.start=message;}
  terminate(){this.terminated=true;}
  emit(data){this.dispatchEvent(new MessageEvent('message',{data}));}
 }
 Object.assign(globalThis,{Worker,location:{search:''},crossOriginIsolated:true});
 try{
  const {subscribeLocalDisc,selectLocalDisc,claimMelee,releaseMelee,usesLocalDisc}=await import('../web/lib/melee-session.ts');
  globalThis.location={hostname:'public.example',search:'?disc=server'};assert.equal(usesLocalDisc(),true);
  globalThis.location={hostname:'localhost',search:'?disc=server'};assert.equal(usesLocalDisc(),false);
  // Exercise the worker transport here; the upstream iframe transport is covered
  // by the headed launcher replay test.
  globalThis.location={hostname:'localhost',search:'?engine=direct-c'};
  const first=[],second=[],off1=subscribeLocalDisc(s=>first.push(s)),off2=subscribeLocalDisc(s=>second.push(s));
  const old=new File(['old'],'old.iso'),file=new File(['verified'],'melee.iso');
  const cancelled=selectLocalDisc(old).catch(e=>e);
  const ready=selectLocalDisc(file),worker=workers.at(-1);
  assert.equal(workers[0].terminated,true);
  assert.match((await cancelled).message,/closed/);
  assert.equal(worker.start.localGame,false);
  assert.equal(worker.start.iso,file);
  assert.equal(worker.start.discVerified,false);
  worker.emit({type:'status',message:'Checking your game… 50%'});
  assert.equal(first.at(-1).ready,false);
  assert.equal(second.at(-1).message,'Checking your game… 50%');
  worker.emit({type:'disc-verified'});
  assert.equal(first.at(-1).ready,false,'hash verification alone does not mean the engine is ready');
  worker.emit({type:'ready-for-selection'});
  await ready;
  assert.equal(first.at(-1).ready,true);
  assert.deepEqual(first,second);
  const session=claimMelee();assert.equal(session.worker,worker);
  releaseMelee(worker);
  assert.equal(worker.terminated,true);
  assert.equal(workers.at(-1).start.iso,file);
  assert.equal(workers.at(-1).start.discVerified,true);
  off1();off2();
 }finally{Object.assign(globalThis,previous);}
});
