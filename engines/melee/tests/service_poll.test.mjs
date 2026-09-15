import test from 'node:test';
import assert from 'node:assert/strict';
import {pollService} from '../web/lib/service-poll.ts';
test('polling recovers from failures and older sessions and aborts on disposal',async()=>{
 const previous=globalThis.fetch;let calls=0,signal;
 let finish;const complete=new Promise(resolve=>finish=resolve),seen=[],errors=[];
 globalThis.fetch=async(_url,options)=>{
  signal=options.signal;calls++;
  if(calls===1)throw Error('temporarily offline');
  return Response.json({session:calls===2?'old':'new',ready:calls>=4});
 };
 const stop=pollService('/api/status',s=>{seen.push(s);if(s.ready)finish();},e=>errors.push(e),1);
 try{
  await Promise.race([complete,new Promise((_,reject)=>setTimeout(()=>reject(Error('poll stalled')),1000).unref())]);
  stop();assert.equal(signal.aborted,true);
  assert.equal(errors.length,1);assert.equal(seen[0].session,'old');assert.equal(seen.at(-1).ready,true);
 }finally{stop();globalThis.fetch=previous;}
});
