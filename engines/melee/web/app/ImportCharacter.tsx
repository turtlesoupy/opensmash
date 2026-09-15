import {preferences} from '@/lib/desktop';
import {useEffect,useRef,useState} from 'react';
import type {Fighter} from './page';
import {names} from './page';
type ImportJob={id:string;state:'queued'|'working'|'complete'|'failed';message:string;fighter?:Fighter};
const pendingKey='melee-pending-import-v1';
export default function ImportCharacter({onImported,onPlay}:{onImported:(f:Fighter)=>void;onPlay:(f:Fighter)=>void}) {
 const [url,setUrl]=useState(''),[target,setTarget]=useState('mario'),[error,setError]=useState('');
 const [job,setJob]=useState<ImportJob|null>(null),[starting,setStarting]=useState(false);
 const [id,setId]=useState(()=>preferences.getItem(pendingKey)||'');
 const imported=useRef(onImported);imported.current=onImported;
 const busy=starting || !!id && (!job || ['queued','working'].includes(job.state));
 useEffect(()=>{
  if(!id)return;
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{
   try {
    const response=await fetch('/api/imports/'+encodeURIComponent(id),{signal:controller.signal});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not check your import.');
    setJob(result);
    if(result.state==='complete'){preferences.removeItem(pendingKey);imported.current(result.fighter);}
    else if(result.state==='failed'){preferences.removeItem(pendingKey);setError(result.message);}
    else timer=setTimeout(poll,1000);
   }catch(e){if(!controller.signal.aborted){setError((e as Error).message);setId('');preferences.removeItem(pendingKey);}}
  };
  void poll();return()=>{controller.abort();clearTimeout(timer);};
 },[id]);
 async function start(event:React.FormEvent) {
  event.preventDefault();setError('');setStarting(true);setId('');setJob(null);
  try {
   const response=await fetch('/api/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url.trim(),target})});
   const result=await response.json();if(!response.ok)throw Error(result.error||'Could not start the import.');
   setJob(result);preferences.setItem(pendingKey,result.id);setId(result.id);
  }catch(e){setError((e as Error).message);}finally{setStarting(false);}
 }
 return <section className="launch-settings create-character">
  <p>Create a character on smash.fun. In its download panel, choose <strong>Copy Melee import URL</strong>, then paste it here.</p>
  <form onSubmit={start}>
   <label>smash.fun import link<input aria-label="smash.fun import link" type="url" required maxLength={4096} value={url} disabled={busy} onChange={e=>setUrl(e.target.value)} placeholder="Paste your import link" autoComplete="off" spellCheck={false}/></label>
   <label>Melee moveset<select aria-label="Melee moveset" value={target} disabled={busy} onChange={e=>setTarget(e.target.value)}>{Object.entries(names).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
   <button className="retro-site-link" type="submit" disabled={busy||!url.trim()}>{busy?'Importing…':'Import character'}</button>
  </form>
  <p>Your character will appear in your roster when it’s ready.</p>
  {(starting||job)&&<p role="status" aria-live="polite">{starting?'Starting import…':job?.state==='complete'?'Character added to your roster.':job?.state==='failed'?'Import failed.':job?.message||'Adding your character…'}</p>}
  {error&&<p role="alert">{error}</p>}
  {job?.state==='complete'&&job.fighter&&<button className="retro-site-link" onClick={()=>onPlay(job.fighter!)}>Play as {job.fighter.name}</button>}
 </section>;
}
