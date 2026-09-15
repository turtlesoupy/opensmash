// Bake display matrices through the original Wasm HSD interpreter. The gallery
// ships custom display data, not original archives, costumes, or a game image.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {worldMatrices,skinMatrices,hsdMatrixBuilder} from '../browser-port/web/matrices.mjs';
const root=new URL('../',import.meta.url),out=new URL('build/gallery/export/motion/',root);
const e=(await WebAssembly.instantiate(fs.readFileSync(new URL('build/browser-port/runtime/melee-animation.wasm',root)))).instance.exports;
const matrix=hsdMatrixBuilder(e),report=[];
for(const slug of ['mario','luigi','captain-falcon','fox','marth','link']){
 const t=JSON.parse(fs.readFileSync(new URL(`build/gallery/${slug}.json`,root)));
 const clips=[],chunks=[];let offset=0,maxBindError=0;
 const rest=t.skeleton.flatMap(j=>[...j.rotation,...j.position,...j.scale]);
 const originalBind=skinMatrices(worldMatrices(t.skeleton,rest,matrix),t.skeleton);
 for(const joint of t.palette)for(let k=0;k<16;k++)maxBindError=Math.max(maxBindError,Math.abs(originalBind[joint*16+k]-(k%5===0?1:0)));
 // Some original costumes encode a small rest-pose offset (Luigi/Link legs,
 // Falcon shoulder). Preserve it exactly; constrain it relative to body size.
 const bodyHeight=Math.max(...t.skeleton.map(j=>j.world[1][3]));
 assert.ok(maxBindError<bodyHeight*.005,`${slug}: unexplained bind offset ${maxBindError}`);
 for(let index=0;index<t.animations.length;index++){
  const a=t.animations[index];assert.equal(a.joints,t.skeleton.length);assert.equal(a.kind,1);
  assert.equal(e.port_begin(a.joints,a.frames,1),0);
  new Float32Array(e.memory.buffer,e.port_bind(),rest.length).set(rest);
  for(const track of a.tracks){
   const bytes=Buffer.from(track.data,'base64');new Uint8Array(e.memory.buffer,e.port_input(),bytes.length).set(bytes);
   assert.equal(e.port_add_track(track.joint,track.channel,track.value,track.slope,bytes.length,track.start),0,`${slug} ${a.name} ${track.channel}`);
  }
  assert.equal(e.port_seek(0),0);
  const frames=Math.ceil(a.frames),baked=new Float32Array(frames*t.palette.length*16);
  for(let frame=0;frame<frames;frame++){
   if(frame)assert.equal(e.port_step(),0);
   const pose=new Float32Array(e.memory.buffer,e.port_pose(),a.joints*9);
   const skin=skinMatrices(worldMatrices(t.skeleton,pose,matrix),t.skeleton);
   t.palette.forEach((joint,j)=>baked.set(skin.subarray(joint*16,joint*16+16),(frame*t.palette.length+j)*16));
  }
  assert.ok(baked.every(Number.isFinite));
  chunks.push(Buffer.from(baked.buffer));clips.push({id:['idle','run','aerial','jab'][index],name:['Idle','Run','Aerial attack','Jab'][index],frames,fps:60,offset});offset+=baked.length;
 }
 fs.writeFileSync(new URL(`${slug}.bin`,out),Buffer.concat(chunks));
 fs.writeFileSync(new URL(`${slug}.json`,out),JSON.stringify({name:t.name,palette:t.palette.length,clips,source:'Melee HSD animation and matrix interpreter; display poses only'}));
 report.push({slug,clips:clips.length,frames:clips.reduce((s,c)=>s+c.frames,0),bytes:offset*4,maxBindError});
}
fs.writeFileSync(new URL('build/gallery/motion-validation.json',root),JSON.stringify(report,null,2));console.log(report);
