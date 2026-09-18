import {forwardRef,useEffect,useImperativeHandle,useMemo,useState} from 'react';
import MeleeExperience,{roster} from './Experience';
import {desktop} from '../web/lib/desktop';
import './trailer-capture.css';

// Keep this instance mounted when revealing it: remounting releases the warmed engine.
export default forwardRef(function TrailerCapture({characters,soundOn}:{characters:any[];soundOn:boolean},ref:any){
 const [slug,setSlug]=useState('thomasdimson'),[ready,setReady]=useState(false),[visible,setVisible]=useState(false),[take,setTake]=useState(0);
 const [controlsVisible,setControlsVisible]=useState(true);
 const [notice,setNotice]=useState(''),[status,setStatus]=useState('Preparing fighters…');
 const available=useMemo(()=>{
  const merged=new Map(roster.map(f=>[f.slug,f]));
  for(const f of characters)merged.set(f.slug,f);
  return [...merged.values()];
 },[characters]);
 const action=useMemo(()=>{
  const character=available.find(f=>f.slug===slug);
  const picks=['mahatmagandhi','eliezeryudkowsky','dannydevito'].filter(s=>s!==slug).slice(0,2).map(s=>available.find(f=>f.slug===s));
  return {type:'character',character,picks,meleeTrailer:true};
 },[available,slug]);
 function arm(next:string){setReady(false);setVisible(false);setNotice('');setStatus('Preparing fighters…');setSlug(next);setTake(t=>t+1);}
 function reveal(selected=slug){
  if(selected!==slug){arm(selected);setNotice('Preparing this player. Click again when ready.');return;}
  if(!ready){setNotice('Still preparing. Click again when the VS screen is ready.');return;}
  setVisible(true);setNotice('');
 }
 useEffect(()=>{
  const key=(event:KeyboardEvent)=>{
   if((event.target as HTMLElement)?.matches('input,select,textarea,[contenteditable=true]'))return;
   if(event.code==='KeyH'&&!visible){event.preventDefault();setControlsVisible(value=>!value);}
   if(event.code==='Escape'&&visible){event.preventDefault();arm(slug);setControlsVisible(true);}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[visible,slug]);
 useImperativeHandle(ref,()=>({launch:(character:any)=>reveal(character.slug)}));
 if(desktop())return <aside className="melee-trailer-controls">Trailer preloading is available in the browser launcher.</aside>;
 return <>
  {!visible&&controlsVisible&&<aside className="melee-trailer-controls">
   <label>Trailer player <select value={slug} onChange={e=>arm(e.target.value)}>{available.map(f=><option key={f.slug} value={f.slug}>{f.name}</option>)}</select></label>
   <span role="status">{ready?'VS ready — click your player to reveal.':status}</span>
   <small>vs. {action.picks.map(p=>p?.name).join(' vs. ')} vs. Marth</small>
   {notice&&<small>{notice}</small>}
   <button disabled={!ready} onClick={()=>reveal()}>Reveal VS</button>
   <button onClick={()=>arm(slug)}>Rearm</button>
   <small>H: hide controls for recording · Esc: reset take</small>
  </aside>}
  <div className={`melee-trailer-capture melee-surface ${visible?'is-visible':'is-preparing'} ${!visible&&(ready||!controlsVisible)?'is-concealed':''}`}>
   <MeleeExperience key={`${slug}:${take}`} action={action} soundOn={visible&&soundOn} trailerReveal={visible} onTrailerReady={()=>setReady(true)} onTrailerStatus={setStatus} onClose={()=>arm(slug)}/>
   {visible&&<button className="melee-trailer-reset" onClick={()=>arm(slug)}>Reset take</button>}
  </div>
 </>;
});
