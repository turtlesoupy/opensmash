import {meleePath} from './paths.ts';
/** One initialized engine waits at the game boundary while the roster is open. */
type Session={worker:Worker;audio:SharedArrayBuffer;ready:Promise<void>;verified:Promise<void>;readyAt:number;cancel:()=>void};
let standby:Session|undefined;
const currentSession=():Session|undefined=>standby;
let localDisc:File|undefined;
const verifiedDiscs=new WeakSet<File>();
type DiscSetup={state:string;ready:boolean;message:string};
let discSetup:DiscSetup={state:'missing',ready:false,message:'Choose your Melee disc.'};
const discListeners=new Set<(status:DiscSetup)=>void>();
function updateDisc(status:DiscSetup){discSetup=status;for(const listener of discListeners)listener(status);}
export function subscribeLocalDisc(listener:(status:DiscSetup)=>void){
 discListeners.add(listener);listener(discSetup);return()=>{discListeners.delete(listener);};
}
export function suspendMelee(){
 standby?.cancel();standby?.worker.terminate();standby=undefined;
}
export function clearLocalDisc(){
 localDisc=undefined;
 suspendMelee();
 updateDisc({state:'missing',ready:false,message:'Choose your Melee disc.'});
}
// The old upload/extraction path is a loopback-only comparison tool.
export const usesLocalDisc=()=>!(['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&new URLSearchParams(location.search).get('disc')==='server');
export async function selectLocalDisc(file:File){
 standby?.cancel();standby?.worker.terminate();standby=undefined;
 localDisc=file;
 updateDisc({state:'checking',ready:false,message:'Checking your local disc…'});
 let session:Session|undefined,listener:((event:MessageEvent)=>void)|undefined;
 try{
  warmMelee();session=currentSession();
  if(!session)throw Error('This browser needs shared memory and OffscreenCanvas support.');
  listener=({data}:MessageEvent)=>{
   if(data.type==='status'&&currentSession()===session)updateDisc({state:'checking',ready:false,message:data.message});
  };
  session.worker.addEventListener('message',listener);
  await session.verified;
  if(currentSession()===session)updateDisc({state:'ready',ready:true,message:'Ready to play.'});
 }catch(error){
  if(localDisc===file&&currentSession()===session){
   standby=undefined;localDisc=undefined;session?.worker.terminate();
   updateDisc({state:'error',ready:false,message:(error as Error).message});
  }
  throw error;
 }finally{if(session&&listener)session.worker.removeEventListener('message',listener);}
}
const sessions=new WeakMap<Worker,Session>();

export function warmMelee(){
 if(standby||!crossOriginIsolated||typeof SharedArrayBuffer==='undefined'||(usesLocalDisc()&&!localDisc))return;
 const disc=localDisc;
 const direct=new URLSearchParams(location.search).get('engine')==='direct-c';
 const worker=new Worker(meleePath(direct?'/engine/direct-c/worker.mjs':'/engine/engine-worker.js'),direct?{type:'module'}:{}),audio=new SharedArrayBuffer(16+(direct?32768:8192)*2*4);
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
  if(data.type==='frame'&&!worker.onmessage)data.bitmap.close();
 });
 worker.addEventListener('error',e=>fail(Error(e.message||'The engine could not start.')));
 const query=new URLSearchParams(location.search);
 worker.postMessage({type:'start',warm:true,character:'pending',skin:'host',localGame:!usesLocalDisc(),
  iso:disc,discVerified:!!disc&&verifiedDiscs.has(disc),
  profile:query.get('profile'),benchmark:query.get('benchmark'),audio});
}

export function claimMelee():Session{
 warmMelee();
 if(!standby)throw Error('This browser needs shared memory support.');
 const session=standby;standby=undefined;return session;
}

export function releaseMelee(worker:Worker){
 sessions.get(worker)?.cancel();sessions.delete(worker);worker.terminate();
 if(!location.pathname?.startsWith('/melee'))warmMelee();
}

if((import.meta as any).hot)(import.meta as any).hot.dispose(()=>{
 standby?.cancel();standby?.worker.terminate();standby=undefined;
});
