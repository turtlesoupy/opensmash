import test from 'node:test';
import assert from 'node:assert/strict';

test('verified disc releases setup before the engine selection barrier', async () => {
  globalThis.location={hostname:'127.0.0.1',pathname:'/melee',search:''};
  globalThis.crossOriginIsolated=true;
  let worker;
  globalThis.Worker=class extends EventTarget {
    constructor(){super();worker=this;}
    postMessage(){}
    terminate(){}
    emit(data){this.dispatchEvent(new MessageEvent('message',{data}));}
  };
  const {selectLocalDisc,claimMelee,clearLocalDisc}=await import('../../engines/melee/web/lib/melee-session.ts');
  try {
    const selecting=selectLocalDisc(new File(['disc'],'test.iso'));
    worker.emit({type:'disc-verified'});
    await selecting;
    const session=claimMelee();
    let ready=false;session.ready.then(()=>{ready=true;});
    await Promise.resolve();assert.equal(ready,false);
    worker.emit({type:'ready-for-selection'});
    await session.ready;assert.equal(ready,true);
  } finally { clearLocalDisc(); }
});

test('effect reconnect keeps the warmed engine; final cleanup terminates it', async () => {
  globalThis.location={hostname:'127.0.0.1',pathname:'/melee',search:''};
  globalThis.crossOriginIsolated=true;
  let worker,terminated=0;
  globalThis.Worker=class extends EventTarget {
    constructor(){super();worker=this;}
    postMessage(){}
    terminate(){terminated++;}
    emit(data){this.dispatchEvent(new MessageEvent('message',{data}));}
  };
  const {selectLocalDisc,retainMelee,clearLocalDisc}=await import('../../engines/melee/web/lib/melee-session.ts');
  const release=retainMelee();
  try {
    const selecting=selectLocalDisc(new File(['disc'],'test.iso'));
    worker.emit({type:'disc-verified'});await selecting;
    release();
    const releaseAgain=retainMelee();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(terminated,0);
    releaseAgain();releaseAgain();
    await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(terminated,1);
  } finally {release();clearLocalDisc();}
});
