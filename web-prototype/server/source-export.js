// Owner-initiated source export: only generated game art, never source photos,
// prompts, credentials, costs or arbitrary checkpoint files.
import {createHash, randomBytes} from 'node:crypto';
export const SOURCE_FILES=['rigged.glb','portrait_raw.png','stock_raw.png','emblem_raw.png','announcer.wav'];
export const OPTIONAL_SOURCE_FILES=['emblem_stencil.png','melee-source.json','melee-source.rgba8','melee-source.identity.dat','melee-source-ready.json'];
export async function prepareSourceExport(job,ownerId,store) {
  if(!ownerId || job?.ownerId!==ownerId) throw Object.assign(new Error('Fighter not found.'),{status:404});
  if(job.status!=='complete') throw Object.assign(new Error('Finish generating this fighter first.'),{status:409});
  const files={};
  const names=[...SOURCE_FILES,...OPTIONAL_SOURCE_FILES.filter(name=>job.checkpoint?.files?.some(f=>f.scope==='output'&&f.name===name))];
  for(const name of names) {
    const entry=job.checkpoint?.files?.find(f=>f.scope==='output' && f.name===name);
    if(!entry) throw Object.assign(new Error('Original character assets are not available for this fighter yet.'),{status:409});
    const raw=await store.read(entry.key);
    if(raw.length>64*1024*1024) throw Object.assign(new Error('Character asset is too large to export.'),{status:413});
    files[name]={key:entry.key,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
  }
  // Storage paths and object property order are not part of the public content.
  const unchanged=/^[a-f0-9]{48}$/.test(job.sourceExport?.capability || '') && Object.keys(job.sourceExport.files||{}).length===names.length && names.every(name=>{
    const previous=job.sourceExport.files?.[name];
    return previous?.bytes===files[name].bytes && previous?.sha256===files[name].sha256;
  });
  return {capability:unchanged?job.sourceExport.capability:randomBytes(24).toString('hex'),files};
}
export function sourceManifest(job) {
  const root=`/engine/character-source/${job.sourceExport.capability}/`;
  return {format:'opensmash-source-v1',slug:job.slug,name:job.displayName||job.name,short:job.short||job.name,
    files:Object.fromEntries(SOURCE_FILES.map(name=>{const {bytes,sha256}=job.sourceExport.files[name];return [name,{url:root+name,bytes,sha256}];})),
    nativeSource:Object.fromEntries(OPTIONAL_SOURCE_FILES.filter(name=>job.sourceExport.files[name]).map(name=>{const {bytes,sha256}=job.sourceExport.files[name];return [name,{url:root+name,bytes,sha256}];}))};
}
