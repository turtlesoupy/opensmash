import {useEffect,useRef,useState} from 'react';
import {extractDiscZip} from '@/lib/disc-archive';
import {desktop} from '@/lib/desktop';
import {restoreLocalDisc,subscribeLocalDisc,selectLocalDisc,clearLocalDisc,usesLocalDisc} from '@/lib/melee-session';
type Setup={state:string;ready:boolean;message:string;storageMessage?:string;progress?:number};
export default function BootScreen({onReady,showReadyPrompt=false,onCleared}:{onReady:(ready:boolean)=>void;showReadyPrompt?:boolean;onCleared?:()=>void}) {
 const [setup,setSetup]=useState<Setup>({state:'checking',ready:false,message:'Checking local game setup…'});
 const [error,setError]=useState(''),[connectionError,setConnectionError]=useState(''),[transfer,setTransfer]=useState<number|null>(null);
 const [clearing,setClearing]=useState(false);
 const [extracting,setExtracting]=useState<number|null>(null);
 const archiveCleanup=useRef<(()=>Promise<void>)|undefined>(undefined);
 useEffect(()=>{const cleanup=(event:PageTransitionEvent)=>{if(!event.persisted)void archiveCleanup.current?.();};window.addEventListener('pagehide',cleanup);return()=>window.removeEventListener('pagehide',cleanup);},[]);
 const input=useRef<HTMLInputElement>(null),request=useRef<XMLHttpRequest|null>(null),ready=useRef(onReady);ready.current=onReady;
 useEffect(()=>{
  if(!desktop()&&usesLocalDisc()){
   void restoreLocalDisc();
   return subscribeLocalDisc(status=>{setSetup(status);if(status.state!=='error')setError('');ready.current(status.ready);});
  }
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  async function poll(){
   try{const response=await fetch('/api/setup',{signal:controller.signal});if(!response.ok)throw Error('Start the local Melee server to load your game.');
    const status:Setup=await response.json();setSetup(status);ready.current(status.ready&&!['receiving','installing'].includes(status.state));setConnectionError('');
   }catch(e){if(!controller.signal.aborted){setConnectionError('Cannot reach the local Melee server. Start it, then retry.');ready.current(false);}}
   if(!controller.signal.aborted)timer=setTimeout(poll,2000);
  }
  void poll();return()=>{controller.abort();clearTimeout(timer);request.current?.abort();};
 },[]);
 async function select(file?:File):Promise<boolean>{
  if(!file)return false;
  if(/\.zip$/i.test(file.name)){
   setError('');setExtracting(0);ready.current(false);
   try{
    const extracted=await extractDiscZip(file,setExtracting);
    setExtracting(null);
    if(!await select(extracted.file)){await extracted.cleanup();return false;}
    await archiveCleanup.current?.();archiveCleanup.current=extracted.cleanup;
   }catch(e){setError(`ZIP extraction failed: ${(e as Error).message}`);ready.current(setup.ready);return false;}
   finally{setExtracting(null);}
   return true;
  }
  if(!/\.(iso|gcm)$/i.test(file.name)||file.size!==1459978240){setError('Choose a full, unmodified Melee USA 1.02 ISO or GCM (1,459,978,240 bytes). RVZ, 7z and patched images are not supported.');return false;}
  try {
   const header=await file.slice(0,0x440).arrayBuffer(),view=new DataView(header);
   if(new TextDecoder().decode(new Uint8Array(header,0,6))!=='GALE01'||view.getUint8(7)!==2||view.getUint32(0x1c)!==0xc2339f3d)throw Error('This is not Melee USA 1.02 (GALE01 revision 2). Choose the correct disc.');
  } catch(e){setError((e as Error).message);return false;}
  if(!desktop()&&usesLocalDisc()){
   setError('');
   try{await selectLocalDisc(file);return true;}catch(e){setError((e as Error).message);return false;}
  }
  setError('');setTransfer(0);ready.current(false);
  const xhr=new XMLHttpRequest();request.current=xhr;
  xhr.open('POST','/api/setup/disc');xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.timeout=600000;
  xhr.upload.onprogress=e=>{if(e.lengthComputable)setTransfer(e.loaded/e.total);};
  xhr.onload=()=>{setTransfer(null);try{const result=JSON.parse(xhr.responseText);if(xhr.status!==202)throw Error(result.error||'Disc setup failed.');setSetup(result);}catch(e){setError((e as Error).message);}};
  xhr.onerror=()=>{setTransfer(null);setError('Transfer interrupted. Check that the local server is running and choose the file again.');};
  xhr.ontimeout=()=>{setTransfer(null);setError('Transfer timed out. Choose the file and try again.');};
  xhr.onabort=()=>{setTransfer(null);setError('Transfer cancelled. You can choose a file again.');};
  xhr.send(file);
  return true;
 }
 async function clearDisc(){
  setClearing(true);setError('');
  try{
   if(!desktop()&&usesLocalDisc())await clearLocalDisc();
   else{
    const response=await fetch('/api/setup/clear',{method:'POST'});
    const result=await response.json();
    if(!response.ok)throw Error(result.error||'Could not clear the disc.');
    setSetup(result);
    desktop()?.setGameActive(false);
    await desktop()?.fullscreen(false);
   }
   ready.current(false);
   onCleared?.();
  }catch(e){setError((e as Error).message);}
  finally{setClearing(false);}
 }
 const busy=clearing||extracting!==null||transfer!==null||['receiving','installing','checking'].includes(setup.state);
 if(showReadyPrompt&&setup.ready&&!busy&&!error&&!connectionError)return <section className="native-ready" aria-label="Ready to play">
  <div role="status"><h2>Select a character to start</h2><p>Choose a fighter from the roster below.</p></div>
 </section>;
 const StatusHeading=showReadyPrompt?'h2':'p';
 return <section className="boot-screen launch-settings" aria-label="Game disc">
  <div className="boot-disc">
   <StatusHeading role="status">{extracting!==null?`Extracting ZIP… ${Math.round(extracting*100)}%`:transfer!==null?`Copying and checking disc… ${Math.round(transfer*100)}%`:setup.state==='failed'||setup.state==='error'?setup.message:setup.ready?'Ready to play.':busy?setup.message: 'Choose your Melee disc to get started.'}</StatusHeading>
   {busy&&<progress aria-label="Disc setup progress" {...(extracting!==null?{value:extracting,max:1}:transfer!==null?{value:transfer,max:1}:{})}/>}
   {(error||connectionError)&&<p role="alert">{error||connectionError}</p>}
   <input ref={input} type="file" accept=".iso,.gcm,.zip" aria-label="Choose Melee ISO, GCM or ZIP" hidden onChange={e=>{select(e.target.files?.[0]);e.target.value='';}}/>
   <button className="boot-action" disabled={extracting!==null||busy&&transfer===null&&!error&&!connectionError||transfer!==null} onClick={async()=>{if(desktop()){try{setError('');await desktop()!.chooseDisc();}catch(e){setError((e as Error).message);}}else input.current?.click();}}>{setup.ready?'Choose another disc':'Choose Melee ISO / GCM / ZIP'}</button>
   {onCleared&&setup.ready&&<button className="boot-action" disabled={busy} onClick={()=>void clearDisc()}>{clearing?'Clearing…':'Clear disc'}</button>}
   {onCleared&&setup.ready&&<small>Clear disc returns to setup. Your original disc file stays on this computer.</small>}
   {transfer!==null&&<button className="retro-site-link" onClick={()=>request.current?.abort()}>Cancel transfer</button>}
   {setup.storageMessage&&<small role="status">{setup.storageMessage}</small>}
   <small>{!desktop()&&usesLocalDisc()?'Your disc is never uploaded. A local copy is saved in this browser for future visits. Clearing site data removes the saved copy.':'Your disc stays on this computer. Choose your Melee USA 1.02 disc once to get started.'}</small>
  </div>
 </section>;
}
