import {meleeTargetFor} from "../../../web-prototype/shared/melee-targets.js";
import {meleePath} from '../web/lib/paths';
import type {Fighter} from '../web/lib/fighter';
import {desktop} from '../web/lib/desktop';
// Resolve generated website fighters through the existing source-export format.
// Both browser and native clients use the same importer API; only its location differs.
export async function resolveFighters(action:any,roster:Fighter[],signal:AbortSignal,onStatus:(message:string)=>void){
 const resolved=new Map<string,Fighter>();
 async function json(url:string,init:RequestInit={}){
  const response=await fetch(url,{...init,signal,headers:{'Content-Type':'application/json',...init.headers}});
  const result=await response.json();if(!response.ok)throw Error(result.error||'Could not prepare the selected fighter.');return result;
 }
 for(const pick of [action.character,...(action.picks||[])].filter(Boolean)){
  if(roster.some(f=>f.slug===pick.slug)||resolved.has(pick.slug))continue;
  onStatus('Preparing '+pick.name+' for Melee…');
  const target=meleeTargetFor(pick);
  const source=await json('/api/melee/source/'+encodeURIComponent(pick.slug),{method:'POST',body:'{}'});
  let job=await json(meleePath('/api/imports'),{method:'POST',body:JSON.stringify({url:new URL(source.url,location.origin).href,target,sourceOnly:!desktop()})});
  while(job.state!=='complete'){
   if(job.state==='failed')throw Error(job.message);
   onStatus(job.message||'Preparing character…');
   await new Promise<void>((resolve,reject)=>{
    const cancel=()=>{clearTimeout(timer);reject(signal.reason||Error('Cancelled'));};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},500);
    if(signal.aborted)cancel();else signal.addEventListener('abort',cancel,{once:true});
   });
   job=await json(meleePath('/api/imports/'+job.id));
  }
  resolved.set(pick.slug,job.fighter);
 }
 return {roster:[...roster,...resolved.values()],action:{...action,character:resolved.get(action.character?.slug)||action.character,picks:(action.picks||[]).map((p:Fighter)=>resolved.get(p.slug)||p)}};
}
