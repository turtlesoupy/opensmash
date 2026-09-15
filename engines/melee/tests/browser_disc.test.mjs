import test from 'node:test';
import assert from 'node:assert/strict';
import {openAsBlob,readFileSync} from 'node:fs';
import {inspectDisc,ISO_SIZE} from '../runtime/web/disc.mjs';

test('rejects truncated discs and wrong game headers before parsing assets',async()=>{
 await assert.rejects(inspectDisc(new Blob([new Uint8Array(64)])),/unexpected size/);
 await assert.rejects(inspectDisc({size:ISO_SIZE,slice:()=>new Blob([new Uint8Array(0x2460)])}),/requires Melee USA 1.02/);
});

test('local ISO slices match independently extracted executable, stage, costume, menu and audio', {skip:!process.env.MELEE_ISO},async()=>{
 const {blobs}=await inspectDisc(await openAsBlob(process.env.MELEE_ISO));
 for(const name of ['sys/main.dol','sys/fst.bin','files/PlMrNr.dat','files/GrNBa.dat','files/MnSlChr.usd','files/audio/us/nr_select.ssm']){
  const entry=blobs.find(e=>e.name===name);assert.ok(entry,name);
  assert.deepEqual(Buffer.from(await entry.data.arrayBuffer()),readFileSync('assets/game/'+name),name);
 }
});
