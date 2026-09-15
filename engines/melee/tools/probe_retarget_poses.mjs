// Sample original HSD motion on every experimental target's own skeleton.
import fs from 'node:fs';
import path from 'node:path';
import {worldMatrices,hsdMatrixBuilder} from '../browser-port/web/matrices.mjs';
const out=path.resolve(process.argv[2]);
const e=(await WebAssembly.instantiate(fs.readFileSync(new URL('../build/browser-port/runtime/melee-animation.wasm',import.meta.url)))).instance.exports;
const matrix=hsdMatrixBuilder(e);
for(const dir of fs.readdirSync(out,{withFileTypes:true}).filter(d=>d.isDirectory())){
 const folder=path.join(out,dir.name),file=path.join(folder,'target.json');if(!fs.existsSync(file))continue;
 if(process.argv[3] && dir.name!==process.argv[3])continue;
 const t=JSON.parse(fs.readFileSync(file)),poses={},clearancePoses=[],report=[],warnings=[];
 try{
  const rest=t.skeleton.flatMap(j=>[...j.rotation,...j.position,...j.scale]);
  for(const a of t.animations){
   try {
   if(a.joints!==t.skeleton.length||a.kind!==1)throw Error('Incompatible animation skeleton');
   if(e.port_begin(a.joints,a.frames,1)!==0)throw Error('Animation exceeds interpreter limits');
   new Float32Array(e.memory.buffer,e.port_bind(),rest.length).set(rest);
   for(const track of a.tracks){
    if(track.channel===11||track.channel===12){warnings.push(a.label+': visibility-only track omitted from matrix preview');continue;}
    const bytes=Buffer.from(track.data,'base64');new Uint8Array(e.memory.buffer,e.port_input(),bytes.length).set(bytes);
    if(e.port_add_track(track.joint,track.channel,track.value,track.slope,bytes.length,track.start)!==0)throw Error('Unsupported track');
   }
   if(e.port_seek(0)!==0)throw Error('Seek failed');
   const frame=Math.min({idle:10,run:8,jab:6,aerial:10}[a.label],Math.ceil(a.frames)-1);
   for(let i=0;i<frame;i++)if(e.port_step()!==0)throw Error('Step failed');
   const pose=new Float32Array(e.memory.buffer,e.port_pose(),a.joints*9);
   const worlds=worldMatrices(t.skeleton,pose,matrix);
   if(!worlds.flat().every(Number.isFinite))throw Error('Nonfinite pose');
   poses[a.label]=worlds.map(m=>[m.slice(0,4),m.slice(4,8),m.slice(8,12),m.slice(12,16)]);
   report.push({clip:a.label,original:a.name,frame,joints:a.joints});
   if(['kirby','jigglypuff'].includes(t.slug)) {
    if(e.port_seek(0)!==0)throw Error('Clearance seek failed');
    for(let f=0;f<Math.ceil(a.frames);f++) {
     if(f%3===0) {
      const sample=new Float32Array(e.memory.buffer,e.port_pose(),a.joints*9);
      clearancePoses.push({clip:a.label,frame:f,worlds:worldMatrices(t.skeleton,sample,matrix).map(m=>[m.slice(0,4),m.slice(4,8),m.slice(8,12),m.slice(12,16)])});
     }
     if(f+1<Math.ceil(a.frames) && e.port_step()!==0)throw Error('Clearance step failed');
    }
   }
   }catch(error){warnings.push(a.label+': '+error.message);}
  }
  fs.writeFileSync(path.join(folder,'poses.json'),JSON.stringify({poses,clearancePoses,report,warnings}));
 }catch(error){fs.writeFileSync(path.join(folder,'poses.json'),JSON.stringify({error:error.message,report}));}
}
