import {useEffect,useRef,useState} from 'react';
async function request(url,options) {
 const response=await fetch(url,options);const result=await response.json();
 if(!response.ok)throw new Error(result.error||'Could not update specials');return result;
}
export default function SpecialsPanel({fighterId,target}) {
 const [job,setJob]=useState(null),[enabled,setEnabled]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[equipped,setEquipped]=useState(false);
 const requestId=useRef(null);
 const base=`/api/fighters/${fighterId}/specials`;
 useEffect(()=>{
  let disposed=false,timer;
  const poll=async()=>{
   try {const result=await request(base);if(!disposed){setJob(result.job);setEnabled(result.enabled);if(result.job&&['complete','failed','cancelled'].includes(result.job.status))requestId.current=null;}}
   catch(e){if(!disposed)setError(e.message);}
   if(!disposed)timer=setTimeout(poll,3000);
  };
  setJob(null);setEquipped(false);requestId.current=null;void poll();
  return ()=>{disposed=true;clearTimeout(timer);};
 },[base]);
 async function act(action) {
  setBusy(true);setError('');
  try {
   let result;
   if(action==='generate') {
    requestId.current ||= crypto.randomUUID();
    result=await request(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:requestId.current})});
   } else result=await request(`${base}/${job.id}/${action}`,{method:'POST'});
   if(action==='equip'){setEquipped(true);window.dispatchEvent(new Event('specials-equipped'));}
   else {setJob(result.job);if(['complete','failed','cancelled'].includes(result.job.status))requestId.current=null;}
  } catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const active=job&&!['complete','failed','cancelled'].includes(job.status);
 return <section className="fighter-settings">
  <h3>Custom specials</h3>
  <p>Create a complete neutral, up, and down special set, including air moves. Available for offline matches.</p>
  {!enabled&&<p>Special generation requires an enabled validation worker.</p>}
  {job&&<p role="status">{job.ready?'Gameplay checks passed for all six moves':job.stage}{job.error?`: ${job.error}`:''}</p>}
  {job?.contexts?.some(context=>context.preview)&&<p>{job.ready?'Review animation and effects before equipping.':'Review clips only: this set failed gameplay checks and cannot be equipped.'}</p>}
  {job?.contexts?.map(context=>context.preview&&<p key={context.slot}><a href={context.preview} target="_blank" rel="noreferrer">Watch {['neutral ground','up ground','down ground','neutral air','up air','down air'][context.slot]}</a></p>)}
  {job?.description&&<details><summary>Attack descriptions</summary>{job.description.moves.map(move=><p key={move.slot}><strong>{move.name}</strong> ({move.slot}) — {move.action}</p>)}</details>}
  {enabled&&!active&&<button type="button" disabled={busy} onClick={()=>act('generate')}>Generate all specials</button>}
  {active&&<button type="button" disabled={busy} onClick={()=>act('cancel')}>Cancel generation</button>}
  {enabled&&job?.status==='failed'&&<button type="button" disabled={busy} onClick={()=>act('retry')}>Retry saved attempt</button>}
  {job?.ready&&job.target===target&&<button type="button" disabled={busy||equipped} onClick={()=>act('equip')}>{equipped?'Equipped for next match':'Equip special set'}</button>}
  {job?.ready&&job.target!==target&&<p>This set uses the {job.target} rig. Switch back or generate a set for {target}.</p>}

  {error&&<p role="alert">{error}</p>}
 </section>;
}
