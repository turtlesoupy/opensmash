import {useEffect,useState} from 'react';
import LaunchSettings from '../web/app/LaunchSettings';
import {loadSettings,defaults,type Settings} from '../web/lib/launch';
import {desktop,preferences} from '../web/lib/desktop';
import {restoreLocalDisc,selectLocalDisc,subscribeLocalDisc,clearLocalDisc,localDiscReady} from '../web/lib/melee-session';
import {pollService} from '../web/lib/service-poll';

// These panels are part of the launcher UI, independent of the game renderer.
export function MeleeDiscSettings(){
 const [status,setStatus]=useState(''),[error,setError]=useState('');
 const [ready,setReady]=useState(localDiscReady),[busy,setBusy]=useState(false);
 useEffect(()=>{if(desktop())return pollService<{message:string;ready:boolean}>('/melee/api/setup',s=>{setStatus(s.message);setReady(s.ready);},e=>setError(e.message));void restoreLocalDisc();return subscribeLocalDisc(s=>{setReady(s.ready);setStatus([s.message,s.storageMessage].filter(Boolean).join(' '));});},[]);
 async function choose(file?:File){
  setError('');
  setBusy(true);
  try{if(desktop())await desktop()!.chooseDisc();else if(file)await selectLocalDisc(file);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
 }
 async function clear(){
  setError('');
  try{
   if(desktop()){
    const response=await fetch('/melee/api/setup/clear',{method:'POST'});
    const result=await response.json();if(!response.ok)throw Error(result.error||'Could not forget this disc.');
    setStatus(result.message);setReady(false);
   }else await clearLocalDisc();
  }catch(e){setError((e as Error).message);}
 }
 return <section className="melee-disc-settings"><h3>Melee disc</h3><p role="status">{status}</p>{error&&<p role="alert">{error}</p>}
  {ready?<button onClick={()=>void clear()}>Clear disc</button>:desktop()?<button disabled={busy} onClick={()=>void choose()}>Upload disc</button>:<label>{busy?"Checking disc…":"Upload disc"}<input disabled={busy} type="file" accept=".iso,.gcm" onChange={e=>void choose(e.target.files?.[0])}/></label>}
 </section>;
}
export function MeleeSettings(){
 const [settings,setSettings]=useState(loadSettings);
 function update(value:Settings){setSettings(value);preferences.setItem('melee-launch-v1',JSON.stringify(value));{const url=new URL(location.href);url.searchParams.delete('moveset');history.replaceState({},'',url);}}
 return <div className="melee-settings"><LaunchSettings section="gameplay" value={settings} onChange={update} roster={[]} unifiedMoveset/><div className="advanced-actions"><button className="launch-flow-action" onClick={()=>update({...defaults(),ports:settings.ports.map(p=>({...p,target:"auto"}))})}>Restore Defaults</button></div></div>;
}
