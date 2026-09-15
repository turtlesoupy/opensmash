import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openAsBlob} from 'node:fs';
import {verifyDisc, verifyDiscChunks} from '../runtime/web/verify-disc.mjs';

const bytes=Uint8Array.from({length:35},(_,i)=>i*7);
const trusted={size:bytes.length,chunkBytes:16,chunks:[0,16,32].map(i=>createHash('sha256').update(bytes.slice(i,i+16)).digest('hex'))};

test('verifies every chunk, including final partial chunk, with bounded sequential reads',async()=>{
 const reads=[],progress=[];
 await verifyDiscChunks({size:bytes.length,slice(start,end){reads.push([start,end]);return new Blob([bytes.slice(start,end)]);}},trusted,n=>progress.push(n));
 assert.deepEqual(reads,[[0,16],[16,32],[32,35]]);
 assert.deepEqual(progress,[0,16,32,35]);
});
for(const position of [0,17,34])test(`rejects corruption at byte ${position}`,async()=>{
 const bad=bytes.slice();bad[position]^=1;
 await assert.rejects(verifyDiscChunks(new Blob([bad]),trusted),/known USA 1.02 Melee disc hash/);
});
test('rejects wrong size, short reads, and unreadable files',async()=>{
 await assert.rejects(verifyDiscChunks(new Blob([bytes.slice(1)]),trusted),/unexpected size/);
 await assert.rejects(verifyDiscChunks({size:35,slice:()=>new Blob([])},trusted),/read completely/);
 await assert.rejects(verifyDiscChunks({size:35,slice(){throw Error('permission denied');}},trusted),/permission denied/);
});
test('checks the pinned manifest against a real disc', {skip:!process.env.MELEE_ISO},async()=>{
 await verifyDisc(await openAsBlob(process.env.MELEE_ISO));
});
