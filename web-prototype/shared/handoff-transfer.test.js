import test from 'node:test';
import assert from 'node:assert/strict';
import {channelInbox,sendGameFile,receiveGameFile,validateTransferHeader} from './handoff-transfer.js';
function pair(){
 class Channel extends EventTarget {send(data){queueMicrotask(()=>this.peer.dispatchEvent(new MessageEvent('message',{data})));}}
 const a=new Channel(),b=new Channel();a.peer=b;b.peer=a;return [a,b];
}
test('receiver requests its game and transfers multiple batches byte-for-byte',async()=>{
 const [a,b]=pair(),controller=new AbortController();
 const ai=channelInbox(a,controller.signal),bi=channelInbox(b,controller.signal);
 const bytes=new Uint8Array(2*1024*1024+79);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;
 let requested;
 try {
  const [file]=await Promise.all([
   receiveGameFile(b,bi,'ssb64',()=>{},()=>{}),
   sendGameFile(a,ai,async game=>{requested=game;return {name:'test.z64',bytes};},()=>{}),
  ]);
  assert.equal(requested,'ssb64');assert.equal(file.name,'test.z64');assert.deepEqual(new Uint8Array(await file.arrayBuffer()),bytes);
 }finally{ai.dispose();bi.dispose();}
});
test('game identity and per-game size limits are checked before allocating storage',()=>{
 assert.doesNotThrow(()=>validateTransferHeader({type:'header',game:'melee',size:1459978240},'melee'));
 for(const header of [{type:'header',game:'melee',size:64},{type:'header',game:'ssb64',size:1459978240},{type:'header',game:'ssb64',size:-1}])assert.throws(()=>validateTransferHeader(header,'ssb64'));
});
test('cancelling rejects a pending protocol wait promptly',async()=>{
 const [channel]=pair(),controller=new AbortController(),inbox=channelInbox(channel,controller.signal);
 const waiting=inbox.next();controller.abort();await assert.rejects(waiting,{name:'HandoffCancelled'});inbox.dispose();
});
test('truncated transfer is rejected rather than acknowledged',async()=>{
 const [a,b]=pair(),ai=channelInbox(a),bi=channelInbox(b);
 try {
  const receiving=receiveGameFile(b,bi,'ssb64',()=>{},()=>{});
  await ai.next();a.send(JSON.stringify({type:'header',game:'ssb64',name:'test.z64',size:4}));
  await ai.next();a.send(new Uint8Array([1,2]).buffer);a.send(JSON.stringify({type:'done'}));
  await assert.rejects(receiving,/before the whole file/);
 }finally{ai.dispose();bi.dispose();}
});
