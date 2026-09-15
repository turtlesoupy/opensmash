import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
const root = new URL('../../', import.meta.url);
const bytes = fs.readFileSync(new URL('build/browser-port/runtime/melee-animation.wasm',root));
const mod = await WebAssembly.compile(bytes);
assert.deepEqual(WebAssembly.Module.imports(mod), [], 'No hidden host or dummy services');
const e = (await WebAssembly.instantiate(mod)).exports;
function add(t) {
 const data = Uint8Array.from(t.data);
 new Uint8Array(e.memory.buffer,e.port_input(),data.length).set(data);
 return e.port_add_track(t.joint??0,t.channel??1,t.value??0,t.slope??0,data.length,t.start??0);
}
const floats = (...xs) => [...new Uint8Array(new Float32Array(xs).buffer)];
const get = () => new Float32Array(e.memory.buffer,e.port_pose(),9)[0];
const near = (x,y,tol=1e-6) => assert.ok(Math.abs(x-y)<=tol,`${x} != ${y}`);
// Independent analytic interpolation and state-machine checks, not snapshots of implementation.
assert.equal(e.port_begin(1,10,0),0);
assert.equal(add({data:[0x12,...floats(2),10,...floats(12)]}),0);
assert.equal(e.port_seek(0),0); near(get(),2);
for(let i=1;i<=10;i++){ assert.equal(e.port_step(),0); near(get(),2+i); }
assert.equal(e.port_seek(3.5),0);near(get(),5.5);
assert.equal(e.port_begin(1,10,1),0);
assert.equal(add({data:[0x13,...floats(0),10,...floats(10)]}),0);
assert.equal(e.port_seek(2.5),0); near(get(),1.5625); // zero-tangent Hermite smoothstep
assert.equal(e.port_seek(9),0);assert.equal(e.port_step(),0);near(e.port_frame(),0);near(get(),0);
// Signed fixed-point and channel 5 translation must not overwrite rotation or scale.
assert.equal(e.port_begin(1,10,0),0);
assert.equal(add({channel:5,value:0x61,data:[0x11,0xfc,10,0xfc]}),0);
assert.equal(e.port_seek(0),0);
near(new Float32Array(e.memory.buffer,e.port_pose(),9)[3],-2);
for(const data of [[],[2],[0x82],[0x12,0],[4,...floats(0)],[0x72,...floats(0)], [1,...floats(NaN)], [1,...floats(1),128]]) {
 assert.equal(e.port_begin(1,10,0),0);assert.equal(add({data}),-1,`Reject ${data}`);
}
assert.equal(e.port_begin(0,10,0),-1); assert.equal(e.port_begin(257,10,0),-1);
assert.equal(e.port_begin(1,NaN,0),-1);assert.equal(e.port_begin(1,10,0),0);
assert.equal(add({channel:4,data:[0x11,...floats(1),10,...floats(1)]}),-1);
assert.equal(add({channel:1,data:[0x11,...floats(1),10,...floats(1)]}),0);
assert.equal(add({channel:1,data:[0x11,...floats(2),10,...floats(2)]}),-2);
assert.equal(e.port_seek(NaN),-1);
near(e.port_fall(-2.75,.13,2.8),Math.fround(-2.8));
near(e.port_fall(1,.13,2.8),Math.fround(.87));
near(e.port_ground_friction(2,.1),Math.fround(-.1));
near(e.port_ground_friction(-2,.1),Math.fround(.1));
near(e.port_ground_friction(.03,.1),Math.fround(-.03));
const data = JSON.parse(fs.readFileSync(new URL('build/browser-port/runtime/mario-local.json',root)));
const report = { scope:'HSD track runtime checks; not Dolphin or combat equivalence',animations:[],failures:[] };
let samples=0;const start=performance.now();
for(const a of data.animations) {
 try {
  assert.equal(e.port_begin(a.joints,a.frames,1),0);
  for(const t of a.tracks) assert.equal(add({...t,data:Buffer.from(t.data,'base64')}),0,`${a.name} joint ${t.joint} channel ${t.channel}`);
  assert.equal(e.port_seek(0),0);
  const check=()=>{const p=new Float32Array(e.memory.buffer,e.port_pose(),a.joints*9);assert.ok(p.every(Number.isFinite));samples++;};check();
  for(let frame=1;frame<=Math.ceil(a.frames)*2+2;frame++){assert.equal(e.port_step(),0);check();}
  // Seeking must reproduce sequential samples, and switching must reset stale channels.
  const target=Math.min(7,Math.floor(a.frames)-1);
  assert.equal(e.port_seek(0),0);for(let i=0;i<target;i++)e.port_step();
  const sequential=new Float32Array(new Float32Array(e.memory.buffer,e.port_pose(),a.joints*9));
  assert.equal(e.port_seek(target),0);
  const seek=new Float32Array(e.memory.buffer,e.port_pose(),a.joints*9);
  for(let i=0;i<seek.length;i++)near(seek[i],sequential[i],2e-5);
  report.animations.push({name:a.name,frames:a.frames,joints:a.joints,tracks:a.tracks.length});
 } catch(err) {report.failures.push({name:a.name,error:err.message});}
}
Object.assign(report,{passed:report.animations.length,failed:report.failures.length,samples,elapsed_ms:performance.now()-start});
fs.writeFileSync(new URL('build/browser-port/runtime/animation-validation.json',root),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,animations:undefined},null,2));
assert.equal(report.failed,0);
