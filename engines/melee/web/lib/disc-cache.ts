/** Private, origin-local disc storage. Never sends game bytes to a server. */
const DIRECTORY='opensmash-melee-disc-v1';
async function root(){
 if(!globalThis.navigator?.storage?.getDirectory)throw Error('Local disc storage is unavailable in this browser.');
 return navigator.storage.getDirectory();
}
async function locked<T>(run:()=>Promise<T>):Promise<T>{
 return globalThis.navigator?.locks?navigator.locks.request(DIRECTORY,run):run();
}
export async function restoreCachedDisc():Promise<File|undefined>{
 if(!globalThis.navigator?.storage?.getDirectory)return;
 return locked(async()=>{
  try{
   const dir=await (await root()).getDirectoryHandle(DIRECTORY);
   const filename=await (await (await dir.getFileHandle('current')).getFile()).text();
   if(!/^(?:disc|incoming)-[a-z0-9-]+\.iso$/.test(filename))throw Error('Invalid disc cache.');
   return await (await dir.getFileHandle(filename)).getFile();
  }catch(e){if((e as Error).name==='NotFoundError')return;throw e;}
 });
}
export async function cacheDisc(file:File,signal:AbortSignal,progress:(fraction:number)=>void){
 return locked(async()=>{
  signal.throwIfAborted();
  const dir=await (await root()).getDirectoryHandle(DIRECTORY,{create:true});
  const receipt=(file as any)[Symbol.for('opensmash.received-disc')] as {name:string;adopted:boolean}|undefined;
  // Reclaim a staging file left by a closed tab before allocating another ISO.
  let current='';
  try{current=await (await (await dir.getFileHandle('current')).getFile()).text();}catch(e){if((e as Error).name!=='NotFoundError')throw e;}
  for await(const entry of (dir as any).keys())if(/^disc-[a-z0-9-]+\.iso$/.test(entry)&&entry!==current&&entry!==receipt?.name)await dir.removeEntry(entry);
  // A tab closed mid-transfer leaves an incoming file. Reclaim it only when
  // its transfer/validation lock is free; never delete another tab's active disc.
  if(navigator.locks)for await(const entry of (dir as any).keys())if(/^incoming-[a-z0-9-]+\.iso$/.test(entry)&&entry!==current&&entry!==receipt?.name){
   await navigator.locks.request(`opensmash-disc:${entry}`,{ifAvailable:true},async lock=>{if(lock)await dir.removeEntry(entry).catch(()=>{});});
  }
  const name=receipt?.name||`disc-${crypto.randomUUID()}.iso`;
  let committed=false;
  try{
   if(!receipt){
   const output=await (await dir.getFileHandle(name,{create:true})).createWritable();
   const reader=file.stream().getReader();let copied=0;
   try{
    while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;await output.write(value);copied+=value.byteLength;progress(copied/file.size);}
    signal.throwIfAborted();await output.close();
   }catch(e){await output.abort().catch(()=>{});throw e;}
   finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
   }
   signal.throwIfAborted();
   // Atomically replace the small pointer only after the complete disc is on disk.
   const manifest=await (await dir.getFileHandle('current',{create:true})).createWritable();
   try{await manifest.write(name);signal.throwIfAborted();await manifest.close();}catch(e){await manifest.abort().catch(()=>{});throw e;}
   committed=true;
   if(receipt)receipt.adopted=true;
   for await(const entry of (dir as any).keys())if(entry!==name&&(entry===current||/^disc-[a-z0-9-]+\.iso$/.test(entry)))await dir.removeEntry(entry).catch(()=>{});
   const persistent=await navigator.storage.persist?.().catch(()=>false);
   return persistent?'Disc saved on this device.':'Disc cached on this device. Clearing site data or browser storage cleanup can remove it.';
  }finally{if(!committed)await dir.removeEntry(name).catch(()=>{});}
 });
}
export async function removeCachedDisc(){
 if(!globalThis.navigator?.storage?.getDirectory)return;
 await locked(async()=>{try{await (await root()).removeEntry(DIRECTORY,{recursive:true});}catch(e){if((e as Error).name!=='NotFoundError')throw e;}});
}
