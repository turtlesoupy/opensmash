import test from 'node:test';
import assert from 'node:assert/strict';

// Exercise the production iframe adapter through its browser message boundary.
function browser(){
 globalThis.location={hostname:'127.0.0.1',origin:'http://localhost',pathname:'/melee',search:''};
 globalThis.crossOriginIsolated=true;
 globalThis.window=new EventTarget();
 const frames=[];
 globalThis.document={documentElement:{moveBefore(){}},body:{append(){}},createElement(){
  const frame={style:{},contentWindow:{postMessage(){}},removed:false,
   remove(){this.removed=true;},
   emit(data){const event=new Event('message');Object.assign(event,{data,source:this.contentWindow,origin:location.origin});window.dispatchEvent(event);},
  };
  frames.push(frame);return frame;
 }};
 return frames;
}

test('verified disc releases setup before the engine selection barrier', async () => {
  const frames=browser();
  const {selectLocalDisc,claimMelee,clearLocalDisc}=await import('../../engines/melee/web/lib/melee-session.ts');
  try {
    const selecting=selectLocalDisc(new File(['disc'],'test.iso'));
    frames.at(-1).emit({type:'disc-verified'});
    await selecting;
    const session=claimMelee();
    let ready=false;session.ready.then(()=>{ready=true;});
    await Promise.resolve();assert.equal(ready,false);
    frames.at(-1).emit({type:'ready-for-selection'});
    await session.ready;assert.equal(ready,true);
  } finally { clearLocalDisc(); }
});

test('effect reconnect keeps the warmed engine; final cleanup terminates it', async () => {
  const frames=browser();
  const {selectLocalDisc,retainMelee,clearLocalDisc}=await import('../../engines/melee/web/lib/melee-session.ts');
  const release=retainMelee();
  try {
    const selecting=selectLocalDisc(new File(['disc'],'test.iso'));
    frames.at(-1).emit({type:'disc-verified'});await selecting;
    release();
    const releaseAgain=retainMelee();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(frames.filter(frame=>frame.removed).length,0);
    releaseAgain();releaseAgain();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(frames.filter(frame=>frame.removed).length,1);
  } finally {release();clearLocalDisc();}
});

test('returning to the unified roster warms the next engine and releases it on exit',async()=>{
 const frames=browser();
 const {selectLocalDisc,retainMelee,claimMelee,releaseMelee,clearLocalDisc}=await import('../../engines/melee/web/lib/melee-session.ts');
 const release=retainMelee();
 try{
  const selecting=selectLocalDisc(new File(['disc'],'test.iso'));
  frames.at(-1).emit({type:'disc-verified'});await selecting;
  const session=claimMelee();assert.equal(frames.length,1);
  releaseMelee(session.worker);
  assert.equal(frames[0].removed,true);assert.equal(frames.length,2);assert.equal(frames[1].removed,false);
  release();await new Promise(resolve=>setTimeout(resolve,10));assert.equal(frames[1].removed,true);
 }finally{release();await clearLocalDisc();}
});


test('without moveBefore browsing allocates no standby and Play mounts one final runtime',async()=>{
 const frames=browser();delete document.documentElement.moveBefore;
 location.search='?disc=server';
 const {retainMelee,claimMelee,releaseMelee}=await import('../../engines/melee/web/lib/melee-session.ts');
 const release=retainMelee();
 try{
  assert.equal(frames.length,0);
  const parent={insertBefore(frame){frame.parentElement=this;}};
  const session=claimMelee({parentElement:parent});
  assert.equal(frames.length,1);assert.equal(frames[0].parentElement,parent);
  releaseMelee(session.worker);assert.equal(frames[0].removed,true);
  assert.equal(frames.length,1,'returning to roster does not allocate a second runtime');
 }finally{release();}
});
