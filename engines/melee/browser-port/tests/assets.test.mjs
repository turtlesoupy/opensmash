import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeSSM,normalizeSEM} from '../web/runtime/ssm.mjs';
import {TypedArchive} from '../web/runtime/archive.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const audio=path.join(root,'assets/game/files/audio');
test('every verified-disc SSM preserves sample bytes and decodes mixed-width voice fields',()=>{
  const files=fs.readdirSync(audio,{recursive:true}).filter(p=>p.endsWith('.ssm'));
  assert.ok(files.length>100);
  for(const p of files) {
    const raw=fs.readFileSync(path.join(audio,p)),original=Buffer.from(raw),out=normalizeSSM(raw),view=new DataView(out.buffer);
    assert.deepEqual(raw,original,'source was mutated: '+p);
    const end=16+raw.readUInt32BE(0),samples=Math.ceil(end/32)*32;
    assert.deepEqual(out.subarray(samples),new Uint8Array(raw.subarray(samples)));
    assert.equal(view.getUint32(8,true),raw.readUInt32BE(8));
    let offset=16;
    for(let i=0;i<raw.readUInt32BE(8);i++) {
      const voices=raw.readUInt32BE(offset);
      assert.equal(view.getUint32(offset,true),voices);
      assert.equal(view.getUint32(offset+4,true),raw.readUInt32BE(offset+4));offset+=8;
      for(let v=0;v<voices;v++,offset+=64)for(let j=0;j<64;j+=2)assert.equal(view.getUint16(offset+j,true),raw.readUInt16BE(offset+j));
    }
  }
});
test('SEM numeric instructions and address tables keep their values',()=>{
  for(const p of fs.readdirSync(audio,{recursive:true}).filter(p=>p.endsWith('.sem'))) {
    const raw=fs.readFileSync(path.join(audio,p)),out=normalizeSEM(raw),view=new DataView(out.buffer);
    for(let offset=0;offset<raw.length;offset+=4)assert.equal(view.getUint32(offset,true),raw.readUInt32BE(offset));
  }
});
test('malformed audio bounds fail before allocation',()=>{
  assert.throws(()=>normalizeSSM(new Uint8Array(8)),/Truncated/);
  const raw=fs.readFileSync(path.join(audio,'smash2.sem'));raw.writeUInt32BE(0xffffffff,0);
  assert.throws(()=>normalizeSEM(raw),/count/);
});
test('archive metadata preserves opaque data and converts rumble commands independently',()=>{
  const raw=fs.readFileSync(path.join(root,'assets/game/files/LbRb.dat'));
  const memory=new WebAssembly.Memory({initial:2});new Uint8Array(memory.buffer,1024,raw.length).set(raw);
  const archive=new TypedArchive(memory,1024,raw.length);
  const view=new DataView(memory.buffer);
  for(const offset of archive.relocations)assert.equal(view.getUint32(archive.data+offset,true),raw.readUInt32BE(32+offset));
  archive.symbol('lbRumbleData');
  const rootOffset=archive.roots.get('lbRumbleData');
  for(let p=rootOffset;p<archive.bound(rootOffset);p+=8) {
    assert.equal(view.getUint8(archive.data+p+4),raw[32+p+4]);
    const target=archive.pointer(p);if(target===null)continue;
    for(let c=target;c+2<=archive.bound(target);c+=2)assert.equal(view.getUint16(archive.data+c,true),raw.readUInt16BE(32+c));
  }
  const before=new Uint8Array(memory.buffer).slice();archive.symbol('lbRumbleData');assert.deepEqual(new Uint8Array(memory.buffer),before);
});
test('invalid archive relocation leaves source untouched',()=>{
  const raw=fs.readFileSync(path.join(root,'assets/game/files/LbRb.dat'));
  raw.writeUInt32BE(0xffffffff,32+raw.readUInt32BE(4));
  const memory=new WebAssembly.Memory({initial:2});new Uint8Array(memory.buffer,1024,raw.length).set(raw);
  assert.throws(()=>new TypedArchive(memory,1024,raw.length),/relocation/);
  assert.deepEqual(new Uint8Array(memory.buffer,1024,raw.length),new Uint8Array(raw));
});
test('particle metadata preserves original bytecode and texture payloads',()=>{
  const raw=fs.readFileSync(path.join(root,'assets/game/files/EfCoData.dat'));
  const memory=new WebAssembly.Memory({initial:Math.ceil((raw.length+1024)/65536)});
  new Uint8Array(memory.buffer,1024,raw.length).set(raw);
  const a=new TypedArchive(memory,1024,raw.length);a.symbol('effCommonDataTable');
  const view=new DataView(memory.buffer),command=a.pointer(0),texture=a.pointer(4);
  assert.equal(view.getUint16(a.data+command,true),0x42);
  const count=raw.readUInt32BE(32+command+8);
  for(let i=0;i<count;i++) {
    const relative=raw.readUInt32BE(32+command+12+i*4);if(!relative)continue;
    const p=command+relative;
    for(let j=0;j<8;j+=2)assert.equal(view.getUint16(a.data+p+j,true),raw.readUInt16BE(32+p+j));
    for(let j=8;j<60;j+=4)assert.equal(view.getUint32(a.data+p+j,true),raw.readUInt32BE(32+p+j));
    assert.equal(view.getUint8(a.data+p+60),raw[32+p+60]);
  }
  assert.equal(view.getUint32(a.data+texture,true),raw.readUInt32BE(32+texture));
  const before=new Uint8Array(memory.buffer).slice();a.symbol('effCommonDataTable');assert.deepEqual(new Uint8Array(memory.buffer),before);
  assert.throws(()=>a.type(8+20,0),/Effect model descriptor schema/);
});
