import test from 'node:test';
import assert from 'node:assert/strict';
import {installDiscReadCache} from '../runtime/web/disc-read-cache.mjs';
function setup(){const source=Uint8Array.from({length:35},(_,i)=>i);const reads=[];const node={id:1,size:source.length,contents:{slice(a,b){reads.push([a,b]);return source.slice(a,b);}}};const fs={stream_ops:{read(){}},reader:{readAsArrayBuffer:b=>b.buffer}};const cache=installDiscReadCache(fs,{blockBytes:8,maxBytes:16});return {source,reads,node,fs,cache};}
test('small repeated and cross-block reads return exact bytes and preserve buffer boundaries',()=>{
 const {source,reads,node,fs}=setup();const b=new Uint8Array(25).fill(255);
 assert.equal(fs.stream_ops.read({node},b,2,13,5),13);assert.deepEqual(b.slice(2,15),source.slice(5,18));assert.equal(b[1],255);assert.equal(b[15],255);
 assert.equal(fs.stream_ops.read({node},b,0,5,12),5);assert.deepEqual(b.slice(0,5),source.slice(12,17));assert.deepEqual(reads,[[0,8],[8,16],[16,24]]);
});
test('evicts least recently used blocks, separates files, and handles short final reads',()=>{
 const {reads,node,fs,cache}=setup();const b=new Uint8Array(20);
 for(const at of [0,8,0,16,8])fs.stream_ops.read({node},b,0,1,at);
 assert.deepEqual(reads,[[0,8],[8,16],[16,24],[8,16]]);
 const other={...node,id:2};fs.stream_ops.read({node:other},b,0,1,8);assert.equal(reads.length,5);
 assert.equal(fs.stream_ops.read({node},b,0,10,32),3);assert.deepEqual([...b.slice(0,3)],[32,33,34]);
 assert.equal(fs.stream_ops.read({node},b,0,10,35),0);cache.clear();fs.stream_ops.read({node},b,0,1,32);assert.equal(reads.length,7);
});
