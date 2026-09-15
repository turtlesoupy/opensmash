// Execute the real game entry point against a bounded diagnostic host.
// Every unfinished platform import throws; none returns fabricated success.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parentPort} from 'node:worker_threads';
import {TypedArchive} from '../web/runtime/archive.mjs';
import { normalizeSSM, normalizeSEM } from '../web/runtime/ssm.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const output=path.join(root,'build/browser-port/game');
const module=await WebAssembly.compile(fs.readFileSync(path.join(output,'melee-game-diagnostic.wasm')));
const declared=WebAssembly.Module.imports(module);
fs.writeFileSync(path.join(output,'imports.json'),JSON.stringify(declared,null,2));
let instance;
const counts={};const events=[];const start=performance.now();
const epochUs=(Date.now()-Date.UTC(2000,0,1))*1000;
const platformChecks=process.argv.includes('--platform-checks');let fifoChecks=0;
function record(name) {
  counts[name]=(counts[name]||0)+1;
  if(!events.includes(name)) { events.push(name);parentPort?.postMessage({event:name});process.stdout.write(name+'\n'); }
  if(performance.now()-start>10000)throw new Error('Diagnostic boot exceeded 10 seconds');
}
function string(ptr) {
  const bytes=new Uint8Array(instance.exports.memory.buffer);
  if(ptr<0 || ptr>=bytes.length)throw new Error('String pointer out of bounds');
  const end=bytes.indexOf(0,ptr);if(end<0)throw new Error('Unterminated host string');
  return new TextDecoder().decode(bytes.subarray(ptr,end));
}
const fst=fs.readFileSync(path.join(root,'assets/game/sys/fst.bin'));
const entryCount=fst.readUInt32BE(8),strings=entryCount*12;
const files=new Map(),byId=new Map(),directories=[{name:'',end:entryCount}];
for(let i=1;i<entryCount;i++) {
  while(i>=directories.at(-1).end)directories.pop();
  const descriptor=fst.readUInt32BE(i*12),pos=strings+(descriptor&0xffffff);
  const name=fst.toString('utf8',pos,fst.indexOf(0,pos));
  const file=directories.at(-1).name+name;
  if(descriptor>>>24)directories.push({name:file+'/',end:fst.readUInt32BE(i*12+8)});
  else { files.set(file.toLowerCase(),i);byId.set(i,{file,length:fst.readUInt32BE(i*12+8)}); }
}
const preferences=new Map();
const fileCache=new Map(),archives=new Map();
const host={
  gx_submit(ptr,size) {
    if(!platformChecks)throw new Error('GX renderer is not implemented');
    assert.equal(Buffer.from(instance.exports.memory.buffer,ptr,size).toString('hex'),'aabbccddeeff003fc0000080000000');fifoChecks++;
  },
  archive_prepare(ptr,size) {
    for(const [key,a] of archives)if(ptr<a.ptr+a.size && ptr+size>a.ptr)archives.delete(key);
    archives.set(ptr,new TypedArchive(instance.exports.memory,ptr,size));
  },
  archive_type(ptr,kind) {
    for(const a of archives.values())if(ptr>=a.data && ptr<a.data+a.dataSize)return a.type(ptr-a.data,kind);
    throw new Error('Typed descriptor does not belong to a loaded archive');
  },
  archive_symbol(ptr,symbol) { archives.get(ptr).symbol(string(symbol)); },
  reset_code() { return 0; },
  reset_button() { return 0; },
  reset(kind,code,menu) { throw new Error(`Game requested reset: ${kind}/${code}/${menu}`); },
  preference_get(key,fallback) { return preferences.get(key)??fallback; },
  preference_set(key,value) { preferences.set(key,value); },
  log(ptr) { process.stdout.write(string(ptr)); },
  fatal(ptr) { throw new Error(string(ptr)); },
  time_us() { return epochUs+(performance.now()-start)*1000; },
  rumble() {}, // The diagnostic host has no physical controller motor.
  card_probe() { return 0; }, // No card inserted in the boot diagnostic.
  retrace(count,ptr,black) { if(!black)throw new Error('Reached visible video: renderer required'); },
  video_config(ptr) { /* Headless host accepts the display timing descriptor. */ },
  dvd_find(ptr) { return files.get(string(ptr).replace(/^\//,'').toLowerCase())??-1; },
  dvd_size(id) { return byId.get(id)?.length??-1; },
  dvd_read(id,ptr,size,offset) {
    const file=byId.get(id);if(!file || size<0 || offset<0 || offset>file.length || size>file.length-offset+31)return -1;
    const memory=new Uint8Array(instance.exports.memory.buffer);
    if(ptr<0 || ptr>memory.length || size>memory.length-ptr)throw new Error('DVD destination outside memory');
    let raw=fileCache.get(id);
    if(!raw) {
      raw=fs.readFileSync(path.join(root,'assets/game/files',file.file));
      if(file.file.endsWith('.ssm'))raw=normalizeSSM(raw);
      if(file.file.endsWith('.sem'))raw=normalizeSEM(raw);
      fileCache.set(id,raw);
    }
    const count=Math.min(size,raw.length-offset);memory.fill(0,ptr,ptr+size);memory.set(raw.subarray(offset,offset+count),ptr);
    return size;
  },
};
const imports={};
for(const item of declared) {
  if(item.kind!=='function')throw new Error('Unsupported diagnostic import '+JSON.stringify(item));
  imports[item.module]??={};
  imports[item.module][item.name]=(...args)=>{
    record(item.module+'.'+item.name);
    if(item.module==='melee_host' && host[item.name])return host[item.name](...args);
    if(item.module==='wasi_snapshot_preview1' && item.name==='fd_write') {
      const [fd,iov,n,written]=args;const view=new DataView(instance.exports.memory.buffer);let size=0;
      for(let i=0;i<n;i++) {
        const p=view.getUint32(iov+i*8,true),length=view.getUint32(iov+i*8+4,true);
        process.stdout.write(Buffer.from(instance.exports.memory.buffer,p,length));size+=length;
      }
      view.setUint32(written,size,true);return 0;
    }
    throw new Error('Unimplemented platform service: '+item.module+'.'+item.name);
  };
}
let error=null;
try {
  instance=await WebAssembly.instantiate(module,imports);
  instance.exports._initialize?.();
  if(platformChecks) {
    assert.equal(instance.exports.port_check_platform(),1);assert.equal(fifoChecks,1);
    assert.throws(()=>instance.exports.port_check_aram_bounds(),/Audio RAM request out of bounds/);
    assert.equal(instance.exports.port_configure_match(-1,12,31,4,480,5),0);
    assert.equal(instance.exports.port_configure_match(8,12,999,4,480,5),0);
    assert.equal(instance.exports.port_configure_match(8,12,31,4,480,5),1);
  } else {
    if(process.argv.includes("--match"))assert.equal(instance.exports.port_configure_match(8,12,31,4,480,5),1);
    instance.exports.main(0,0);
  }
} catch(e) { error=e.stack;process.stderr.write(error+'\n'); }
fs.writeFileSync(path.join(output,platformChecks?'platform-report.json':'boot-report.json'),JSON.stringify({scope:platformChecks?'native platform regression checks; not gameplay':'real game entry; diagnostic host; not a playable match',match_requested:process.argv.includes('--match'),passed:platformChecks&&!error,elapsed_ms:performance.now()-start,events,counts,error},null,2));
if(error)process.exitCode=1;
