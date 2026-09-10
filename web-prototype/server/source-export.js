// Owner-initiated source export: only generated game art, never source photos,
// prompts, credentials, costs or arbitrary checkpoint files.
import {createHash, randomBytes} from 'node:crypto';
export const SOURCE_FILES=['rigged.glb','portrait_raw.png','stock_raw.png','emblem_raw.png','announcer.wav'];
export async function prepareSourceExport(job,ownerId,store) {
  if(!ownerId || job?.ownerId!==ownerId) throw Object.assign(new Error('Fighter not found.'),{status:404});
  if(job.status!=='complete') throw Object.assign(new Error('Finish generating this fighter first.'),{status:409});
  const files={};
  for(const name of SOURCE_FILES) {
    const entry=job.checkpoint?.files?.find(f=>f.scope==='output' && f.name===name);
    if(!entry) throw Object.assign(new Error('Original character assets are not available for this fighter yet.'),{status:409});
    const raw=await store.read(entry.key);
    if(raw.length>64*1024*1024) throw Object.assign(new Error('Character asset is too large to export.'),{status:413});
    files[name]={key:entry.key,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')};
  }
  const unchanged=JSON.stringify(files)===JSON.stringify(job.sourceExport?.files);
  return {capability:unchanged?job.sourceExport.capability:randomBytes(24).toString('hex'),files};
}
export function sourceManifest(job) {
  const root=`/engine/character-source/${job.sourceExport.capability}/`;
  return {format:'opensmash-source-v1',slug:job.slug,name:job.displayName||job.name,short:job.short||job.name,
    files:Object.fromEntries(SOURCE_FILES.map(name=>{const {bytes,sha256}=job.sourceExport.files[name];return [name,{url:root+name,bytes,sha256}];}))};
}
