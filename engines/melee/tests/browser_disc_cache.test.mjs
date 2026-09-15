import test from 'node:test';
import assert from 'node:assert/strict';
import {cacheDisc,restoreCachedDisc,removeCachedDisc} from '../web/lib/disc-cache.ts';
import {stickVector} from '../web/lib/touch-pad.ts';
const missing=()=>new DOMException('missing','NotFoundError');
class Directory {
 entries=new Map();fail=false;
 async getDirectoryHandle(n,{create=false}={}){if(!this.entries.has(n)){if(!create)throw missing();this.entries.set(n,new Directory());}return this.entries.get(n);}
 async getFileHandle(n,{create=false}={}){
  if(!this.entries.has(n)){if(!create)throw missing();this.entries.set(n,new File([],n));}
  return {getFile:async()=>this.entries.get(n),createWritable:async()=>{
   let parts=[];return {write:async b=>{if(this.fail)throw new DOMException('quota','QuotaExceededError');parts.push(b);},close:async()=>this.entries.set(n,new File(parts,n)),abort:async()=>{parts=[];}};
  }};
 }
 async removeEntry(n){if(!this.entries.delete(n))throw missing();}
 async *keys(){yield* this.entries.keys();}
}
test('disc cache commits complete files, preserves old copy on abort/quota, and clears only its directory',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'navigator'),root=new Directory();
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{storage:{getDirectory:async()=>root,persist:async()=>false}}});
 try{
  root.entries.set('saves',new Directory());assert.equal(await restoreCachedDisc(),undefined);
  await cacheDisc(new File(['verified original'],'original.iso'),new AbortController().signal,()=>{});
  assert.equal(await(await restoreCachedDisc()).text(),'verified original');
  const dir=root.entries.get('opensmash-melee-disc-v1');dir.entries.set('disc-abandoned.iso',new File(['incomplete'],'disc-abandoned.iso'));
  const cancel=new AbortController();await assert.rejects(cacheDisc(new File(['replacement'],'new.iso'),cancel.signal,()=>cancel.abort()),{name:'AbortError'});
  assert.equal(await(await restoreCachedDisc()).text(),'verified original');
  assert.equal(dir.entries.has('disc-abandoned.iso'),false,'abandoned staging files are reclaimed before another copy');
  root.entries.get('opensmash-melee-disc-v1').fail=true;
  await assert.rejects(cacheDisc(new File(['replacement'],'new.iso'),new AbortController().signal,()=>{}),{name:'QuotaExceededError'});
  assert.equal(await(await restoreCachedDisc()).text(),'verified original');
  await removeCachedDisc();assert.equal(await restoreCachedDisc(),undefined);assert(root.entries.has('saves'));
 }finally{if(previous)Object.defineProperty(globalThis,'navigator',previous);else delete globalThis.navigator;}
});
test('GameCube touch stick has neutral dead zone, full throw, inverted Y and circular diagonals',()=>{
 assert.deepEqual(stickVector(2,2,50),{x:0,y:0});
 assert.deepEqual(stickVector(100,0,50),{x:100,y:0});
 assert.deepEqual(stickVector(0,-50,50),{x:0,y:100});
 assert.deepEqual(stickVector(50,50,50),{x:71,y:-71});
 assert.deepEqual(stickVector(NaN,1,50),{x:0,y:0});
});
