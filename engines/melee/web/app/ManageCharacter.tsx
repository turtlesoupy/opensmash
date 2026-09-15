import {useState} from 'react';
import type {Fighter} from './page';
import {names} from './page';
export default function ManageCharacter({fighter,onPlay,onRemoved}:{fighter:Fighter;onPlay:(f:Fighter)=>void;onRemoved:(f:Fighter)=>void}) {
 const [confirm,setConfirm]=useState(false),[removing,setRemoving]=useState(false),[error,setError]=useState('');
 async function remove() {
  if(!confirm){setConfirm(true);return;}
  setRemoving(true);setError('');
  try {
   const response=await fetch('/api/imports/'+encodeURIComponent(fighter.slug),{method:'DELETE'});
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw Error(result.error||'Could not remove the character.');
   onRemoved(fighter);
  }catch(e){setError((e as Error).message);setConfirm(false);}finally{setRemoving(false);}
 }
 return <section className="launch-settings create-character manage-character">
  <div className="manage-character-summary">
   <img src={fighter.portrait||`/portraits/${fighter.slug}.webp`} alt="" width="90" height="86"/>
   <div><strong>{fighter.name}</strong><span>{names[fighter.target]} moveset · imported from smash.fun</span></div>
  </div>
  <button className="retro-site-link" type="button" onClick={()=>onPlay(fighter)}>Play as {fighter.name}</button>
  <button className={`retro-site-link manage-character-remove ${confirm?'is-confirming':''}`} type="button" disabled={removing} onClick={remove} onBlur={()=>{if(!removing)setConfirm(false);}}>
   {removing?'Removing…':confirm?'Really remove? Tap again':'Remove from roster'}
  </button>
  <p>Removing deletes this character’s converted costume from this computer. Its smash.fun creation is not affected, so you can import it again later.</p>
  {error&&<p role="alert">{error}</p>}
 </section>;
}
