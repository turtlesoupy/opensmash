import {meleePath} from './paths';

/** Browser fitting: one disposable worker per fit, no persistent fitted cache. */
export async function prepareNativeCostume(entry:{character:string;target:string;color:number},signal:AbortSignal):Promise<{filename:string;blob:Blob}> {
  const response=await fetch(meleePath('/api/native-fit/source/'+encodeURIComponent(entry.character)),{method:'POST',signal});
  const source=await response.json();
  if(!response.ok)throw Error(source.error||'The character could not be prepared.');
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('Aborted','AbortError'));return;}
    const worker=new Worker(meleePath('/engine/native-fit/worker.mjs'),{type:'module'});
    const cleanup=()=>{clearTimeout(timeout);signal.removeEventListener('abort',cancel);worker.terminate();};
    const cancel=()=>{cleanup();reject(new DOMException('Aborted','AbortError'));};
    const timeout=setTimeout(()=>{cleanup();reject(Error('Native character preparation timed out.'));},30000);
    signal.addEventListener('abort',cancel,{once:true});
    worker.onerror=event=>{cleanup();reject(Error(event.message||'Native fitting worker failed'));};
    worker.onmessage=({data})=>{
      cleanup();
      if(data.error){reject(Error(data.error));return;}
      data.metrics={...data.metrics,sourceCached:source.cached,sourcePreparationMs:source.sourcePreparationMs};
      console.info('[Native fit]',data.metrics);
      const diagnostics=window as Window & {meleeNativeFits?:unknown[]};
      diagnostics.meleeNativeFits=[...(diagnostics.meleeNativeFits||[]),data.metrics].slice(-32);
      resolve({filename:data.filename,blob:new Blob([data.bytes],{type:'application/octet-stream'})});
    };
    worker.postMessage({...entry,sourceBase:meleePath(source.base)});
  });
}
