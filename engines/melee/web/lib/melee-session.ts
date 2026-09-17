import {cacheDisc,restoreCachedDisc,removeCachedDisc} from './disc-cache.ts';
import {unlockAudio} from './audio.ts';
import {MeleeFrameWorker} from './melee-frame-worker.ts';
import {meleePath} from './paths.ts';
/** One loaded runtime waits for Play; native graphics setup stays out of browsing. */
type Session={worker:Worker;audio:SharedArrayBuffer;ready:Promise<void>;verified:Promise<void>;readyAt:number;cancel:()=>void};
let standby:Session|undefined;
const currentSession=():Session|undefined=>standby;
let localDisc:File|undefined;
const verifiedDiscs=new WeakSet<File>();
type DiscSetup={state:string;ready:boolean;message:string;storageMessage?:string};
let discSetup:DiscSetup={state:'missing',ready:false,message:'Choose your Melee disc.'};
const discListeners=new Set<(status:DiscSetup)=>void>();
let discRevision=0,restoreStarted=false;
let cacheAbort:AbortController|undefined;
let restoring:Promise<void>|undefined;
export const localDiscReady=()=>discSetup.ready;
let consumers=0;
let suspendTimer:ReturnType<typeof setTimeout>|undefined;
/** Effect replay must not discard a disc that is already warming. */
export function retainMelee(){
 consumers++;
 warmMelee();
 clearTimeout(suspendTimer);suspendTimer=undefined;
 let released=false;
 return()=>{
  if(released)return;released=true;
  if(--consumers===0)suspendTimer=setTimeout(()=>{
   suspendTimer=undefined;
   if(consumers===0)suspendMelee();
  },0);
 };
}
function updateDisc(status:DiscSetup){discSetup=status;for(const listener of discListeners)listener(status);}
export function subscribeLocalDisc(listener:(status:DiscSetup)=>void){
 discListeners.add(listener);listener(discSetup);return()=>{discListeners.delete(listener);};
}
export function suspendMelee(){
 standby?.cancel();standby?.worker.terminate();standby=undefined;
 if(discSetup.state==='checking'&&localDisc){
  ++discRevision;cacheAbort?.abort();localDisc=undefined;restoreStarted=false;
  updateDisc({state:'missing',ready:false,message:'Disc setup cancelled. Choose your disc to continue.'});
 }
}
export async function clearLocalDisc(){
 ++discRevision;restoreStarted=true;cacheAbort?.abort();
 localDisc=undefined;
 suspendMelee();
 updateDisc({state:'missing',ready:false,message:'Choose your Melee disc.'});
 restoreStarted=true;
 await removeCachedDisc();
}
// The old upload/extraction path is a loopback-only comparison tool.
export const usesLocalDisc=()=>!(['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&new URLSearchParams(location.search).get('disc')==='server');
export function restoreLocalDisc():Promise<void>{
 if(restoreStarted||localDisc||!usesLocalDisc())return restoring||Promise.resolve();
 restoring=restoreDiscFromStorage();return restoring;
}
async function restoreDiscFromStorage(){
 restoreStarted=true;const revision=discRevision;
 updateDisc({state:'checking',ready:false,message:'Looking for your saved disc…'});
 try{
  const file=await restoreCachedDisc();
  if(revision!==discRevision)return;
  if(file)await selectLocalDisc(file,true);
  else updateDisc({state:'missing',ready:false,message:'Choose your Melee disc.'});
 }catch(e){if(revision===discRevision)updateDisc({state:'error',ready:false,message:`Could not restore your disc. Choose it again. ${(e as Error).message}`});}
}
export async function selectLocalDisc(file:File,restored=false){
 const revision=++discRevision;restoreStarted=true;cacheAbort?.abort();
 const controller=new AbortController();cacheAbort=controller;
 // Opening the audio device can block on some hosts. Do it during disc setup,
 // before gameplay, and reuse the context when the match connects its ring.
 void unlockAudio().catch(()=>{});
 standby?.cancel();standby?.worker.terminate();standby=undefined;
 localDisc=file;
 updateDisc({state:'checking',ready:false,message:'Checking your local disc…'});
 let session:Session|undefined,listener:((event:MessageEvent)=>void)|undefined;
 try{
  if(!crossOriginIsolated||typeof SharedArrayBuffer==='undefined')throw Error('This browser needs shared memory support.');
  if(canReparentRuntime()){
   warmMelee();session=currentSession();
   if(!session)throw Error('The game runtime could not start.');
   listener=({data}:MessageEvent)=>{
    if(data.type==='status'&&currentSession()===session)updateDisc({state:'checking',ready:false,message:data.message});
   };
   session.worker.addEventListener('message',listener);
   await session.verified;
  }else{
   // Verify without allocating a standby WASM runtime that Safari cannot move.
   // Launch will allocate exactly one runtime inside its final game surface.
   const {verifyDisc}=await import(/* @vite-ignore */ meleePath('/engine/verify-disc.mjs'));
   await verifyDisc(file,(bytes:number)=>{if(revision===discRevision)updateDisc({state:'checking',ready:false,message:`Checking your game… ${Math.floor(bytes/file.size*100)}%`});});
   verifiedDiscs.add(file);
  }
  if(revision!==discRevision)return;
  let storageMessage='Saved disc restored from this device.';
  if(currentSession()===session&&!restored){
   // Finish the disk copy before enabling play, keeping I/O out of the match.
   if(session&&listener)session.worker.removeEventListener('message',listener);
   let lastPercent=-1;
   try{storageMessage=await cacheDisc(file,controller.signal,fraction=>{
    const percent=Math.floor(fraction*100);
    if(revision===discRevision&&percent!==lastPercent){lastPercent=percent;updateDisc({state:'checking',ready:false,message:`Saving disc on this device… ${percent}%`});}
   });}catch(e){
    if(controller.signal.aborted)return;
    storageMessage=`Playing without a saved copy. ${(e as Error).name==='QuotaExceededError'?'Not enough browser storage.':(e as Error).message} Choose the disc again next visit.`;
   }
  }
  if(revision===discRevision&&currentSession()===session)updateDisc({state:'ready',ready:true,message:'Ready to play.',storageMessage});
 }catch(error){
  if(localDisc===file&&currentSession()===session){
   standby=undefined;localDisc=undefined;session?.worker.terminate();
   updateDisc({state:'error',ready:false,message:(error as Error).message});
  }
  throw error;
 }finally{if(session&&listener)session.worker.removeEventListener('message',listener);}
}
const sessions=new WeakMap<Worker,Session>();
const canReparentRuntime=()=>typeof (document.documentElement as HTMLElement&{moveBefore?:unknown}).moveBefore==='function'||new URLSearchParams(location.search).get('presentation')==='bitmap';

export function warmMelee(surface?:HTMLCanvasElement){
 if((!surface&&!canReparentRuntime())||standby||!crossOriginIsolated||typeof SharedArrayBuffer==='undefined'||(usesLocalDisc()&&!localDisc))return;
 const disc=localDisc;
 const worker=new MeleeFrameWorker(meleePath('/engine/upstream/runtime.html'),surface) as Worker;
 const audio=new SharedArrayBuffer(16+32768*2*4);
 let resolve!:()=>void,reject!:(reason:Error)=>void;
 let verify!:()=>void,rejectVerify!:(reason:Error)=>void;
 const verified=new Promise<void>((ok,fail)=>{verify=ok;rejectVerify=fail;});
 void verified.catch(()=>{});
 const ready=new Promise<void>((ok,fail)=>{resolve=ok;reject=fail;});
 void ready.catch(()=>{});
 const fail=(error:Error)=>{reject(error);rejectVerify(error);};
 const session={worker,audio,ready,verified,readyAt:0,cancel:()=>fail(Error('Game closed'))};
 standby=session;sessions.set(worker,session);
 worker.addEventListener('message',({data})=>{
  if(data.type==='ready-for-selection'){session.readyAt=Date.now();resolve();}
  if(data.type==='disc-verified'&&disc){verifiedDiscs.add(disc);verify();}
  if(data.type==='error')fail(Error(data.message));
  if(data.type==='frame'&&!worker.onmessage)data.bitmap?.close();
 });
 worker.addEventListener('error',e=>fail(Error(e.message||'The engine could not start.')));
 const query=new URLSearchParams(location.search);
 worker.postMessage({type:'start',warm:true,character:'pending',skin:'host',localGame:!usesLocalDisc(),
  iso:disc,discVerified:!!disc&&verifiedDiscs.has(disc),
  profile:query.get('profile'),benchmark:query.get('benchmark'),audio});
}

export function claimMelee(surface?:HTMLCanvasElement):Session{
 // Safari cannot reparent a warmed iframe without reloading it. Recreate the
 // runtime in its final parent, retaining the already verified local File.
 if(surface?.parentElement&&!('moveBefore' in surface.parentElement)&&new URLSearchParams(location.search).get('presentation')!=='bitmap'){
  standby?.cancel();standby?.worker.terminate();standby=undefined;
 }
 warmMelee(surface);
 if(!standby)throw Error('This browser needs shared memory support.');
 const session=standby;standby=undefined;return session;
}

export function releaseMelee(worker:Worker){
 sessions.get(worker)?.cancel();sessions.delete(worker);worker.terminate();
 if(consumers>0||!location.pathname?.startsWith('/melee'))warmMelee();
}

if((import.meta as any).hot)(import.meta as any).hot.dispose(()=>{
 standby?.cancel();standby?.worker.terminate();standby=undefined;
});
