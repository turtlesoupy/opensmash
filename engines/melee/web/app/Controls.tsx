import {useEffect,useState,useSyncExternalStore} from 'react';
import {desktop} from '@/lib/desktop';
import {gamepadAxes,rebindAxes,actions,buttonActions,connectedGamepads,defaults,eventCode,gamepadBindings,resetGamepad,familyNames,keyLabel,loadBindings,padActions,padFamily,padLabel,rebindButton,rebindKey,saveBindings,subscribeBindings,type Action,type ButtonAction,type PadFamily} from '@/lib/controls';
type Pending={kind:'key',action:Action}|{kind:'button',action:ButtonAction}|null;
export default function Controls() {
 const bindings=useSyncExternalStore(subscribeBindings,loadBindings,loadBindings);
 const [heldKeys,setHeldKeys]=useState<Set<string>>(()=>new Set());
 const [padHeld,setPadHeld]=useState<Set<Action>>(()=>new Set());
 const [pads,setPads]=useState<{id:string,family:PadFamily}[]>([]);
 const [profile,setProfile]=useState('');
 const mapping=gamepadBindings(bindings,profile),axes=gamepadAxes(bindings,profile);
 const [pending,setPending]=useState<Pending>(null);
 useEffect(()=>{
  const down=(e:KeyboardEvent)=>{
   if(e.target instanceof HTMLElement&&e.target.matches('input,select,textarea'))return;
   const code=eventCode(e);
   if(pending&&code==='Escape'){e.preventDefault();e.stopImmediatePropagation();setPending(null);return;}
   if(pending?.kind==='key'){
    e.preventDefault();e.stopImmediatePropagation();
    if(code==='Escape'){setPending(null);return;}
    const next=rebindKey(bindings,pending.action,code);
    if(next!==bindings){saveBindings(next);setPending(null);}
    return;
   }
   if(Object.values(bindings.keyboard).includes(code)){e.preventDefault();setHeldKeys(s=>s.has(code)?s:new Set(s).add(code));}
  };
  const up=(e:KeyboardEvent)=>{const code=eventCode(e);setHeldKeys(s=>{if(!s.has(code))return s;const n=new Set(s);n.delete(code);return n;});};
  const blur=()=>setHeldKeys(new Set());
  window.addEventListener('keydown',down,true);window.addEventListener('keyup',up,true);window.addEventListener('blur',blur);
  return()=>{window.removeEventListener('keydown',down,true);window.removeEventListener('keyup',up,true);window.removeEventListener('blur',blur);};
 },[bindings,pending]);
 useEffect(()=>{
  let raf=0,previous=new Set<number>();
  const poll=()=>{
   const connected=connectedGamepads();
   setPads(list=>{const next=connected.map(p=>({id:p.id,family:padFamily(p.id)}));return JSON.stringify(list)===JSON.stringify(next)?list:next;});
   const active=new Set<Action>(),pressed=new Set<number>();
   for(const pad of connected.filter(p=>!profile||p.id===profile)){for(const a of padActions(pad,gamepadBindings(bindings,pad.id),gamepadAxes(bindings,pad.id)))active.add(a);pad.buttons.forEach((b,i)=>{if(b.pressed||b.value>0.5)pressed.add(i);});}
   if(pending?.kind==='button'){
    const fresh=[...pressed].find(i=>!previous.has(i));
    if(fresh!==undefined){const next=rebindButton(bindings,pending.action,fresh,profile||undefined);if(next!==bindings){saveBindings(next);setPending(null);}}
   }
   previous=pressed;
   setPadHeld(s=>s.size===active.size&&[...active].every(a=>s.has(a))?s:active);
   raf=requestAnimationFrame(poll);
  };
  raf=requestAnimationFrame(poll);
  return()=>cancelAnimationFrame(raf);
 },[bindings,pending,profile]);
 const family:PadFamily=pads.find(p=>p.id===profile)?.family??pads[0]?.family??'xbox';
 const isButton=(id:Action):id is ButtonAction=>(buttonActions as string[]).includes(id);
 const stickLabel=(id:Action)=>({up:'Left stick ↑',down:'Left stick ↓',left:'Left stick ←',right:'Left stick →',cup:'Right stick ↑',cdown:'Right stick ↓',cleft:'Right stick ←',cright:'Right stick →'} as Record<string,string>)[id];
 return <div className="controls-screen">
 <p>{desktop()?'Press a key or gamepad button to see it light up. Click a key to rebind it; keyboard changes apply to your next match.':'Press a key or gamepad button to see it light up. Click a key to rebind it. Click the game to use your keyboard.'}</p>
 <p className="controls-pad-status">{pads.length?`Connected: ${pads.map(p=>familyNames[p.family]).join(', ')}. Assign controllers to players in Settings → Players & Controllers.`:'No gamepad detected — connect one and press a button. Xbox button names shown.'}</p>
 <label>Controller profile <select value={profile} onChange={e=>{setProfile(e.target.value);setPending(null);}}>
  <option value="">Default for new controllers</option>
  {[...new Set([...pads.map(p=>p.id),...Object.keys(bindings.profiles||{}),...Object.keys(bindings.axisProfiles||{})])].map(id=><option key={id} value={id}>{id}</option>)}
 </select></label>
 <p>Choose a controller to save its own buttons. Controllers of the same model share a profile.</p>
 <dl className="controls-list controls-grid" aria-live="polite">
  <div className="controls-head" aria-hidden="true"><dt>Action</dt><dd>Keyboard</dd><dd>Gamepad</dd></div>
  {actions.map(action=>{
   const code=bindings.keyboard[action.id];
   const keyPending=pending?.kind==='key'&&pending.action===action.id;
   const buttonPending=pending?.kind==='button'&&pending.action===action.id;
   const pad=isButton(action.id)?action.id:null;
   return <div key={action.id}><dt>{action.label}</dt>
    <dd><button type="button" className={'keycap'+(heldKeys.has(code)?' is-pressed':'')+(keyPending?' is-pending':'')} onClick={()=>setPending(keyPending?null:{kind:'key',action:action.id})} aria-label={`${action.label}: ${keyLabel(code)}. Click to rebind`}>{keyPending?'Press a key…':keyLabel(code)}</button></dd>
    <dd>{pad!==null
     ?<button type="button" className={'keycap keycap-pad'+(padHeld.has(pad)?' is-pressed':'')+(buttonPending?' is-pending':'')} onClick={()=>setPending(buttonPending?null:{kind:'button',action:pad})} aria-label={`${action.label}: ${padLabel(mapping[pad],family)}. Click to rebind`}>{buttonPending?'Press a button…':padLabel(mapping[pad],family)}</button>
     :<span className={'keycap keycap-pad keycap-fixed'+(padHeld.has(action.id)?' is-pressed':'')}>{stickLabel(action.id)}</span>}</dd>
   </div>;
  })}
 </dl>
 <fieldset><legend>Controller sticks</legend>
 {([['x','invertX','Move horizontally'],['y','invertY','Move vertically'],['cx','invertCX','C-stick horizontally'],['cy','invertCY','C-stick vertically']] as const).map(([axis,invert,label])=><div key={axis}>
  <label>{label} <select value={axes[axis]} onChange={e=>saveBindings(rebindAxes(bindings,{...axes,[axis]:Number(e.target.value)},profile||undefined))}>{Array.from({length:16},(_,i)=><option value={i} key={i}>Axis {i+1}</option>)}</select></label>
  <label><input type="checkbox" checked={axes[invert]} onChange={e=>saveBindings(rebindAxes(bindings,{...axes,[invert]:e.target.checked},profile||undefined))}/> Reverse direction</label>
 </div>)}
 <label>Stick deadzone <input type="number" min="0" max="95" step="1" value={Math.round(axes.deadzone*100)} onChange={e=>saveBindings(rebindAxes(bindings,{...axes,deadzone:Number(e.target.value)/100},profile||undefined))}/>%</label>
 </fieldset>
 <div className="controls-actions">
  {pending&&<button type="button" className="settings-menu-button" onClick={()=>setPending(null)}>Cancel</button>}
  <button type="button" className="settings-menu-button" onClick={()=>{saveBindings(profile?resetGamepad(bindings,profile):defaults());setPending(null);}}>{profile?'Reset this controller':'Reset all controls'}</button>
 </div>
 {!desktop()&&<p>Touch controls appear on touch devices.</p>}
 </div>;
}
