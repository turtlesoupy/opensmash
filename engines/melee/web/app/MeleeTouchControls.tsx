import './MeleeTouchControls.css';
import {useEffect,useRef,type MutableRefObject,type PointerEvent} from 'react';
import {neutralTouchPad,stickVector,type TouchPad} from '../lib/touch-pad';
const actions=[['L','Shield',0x40],['Start','Pause',0x1000],['Z','Grab',0x10],['R','Shield',0x20],['Y','Jump',0x800],['X','Jump',0x400],['B','Special',0x200],['A','Attack',0x100]] as const;
export default function MeleeTouchControls({pad}:{pad:MutableRefObject<TouchPad>}){
 const deck=useRef<HTMLDivElement>(null);
 const pointers=useRef(new Map<number,{kind:string;button?:number;element:HTMLElement}>());
 const refresh=()=>{
  let buttons=0;for(const p of pointers.current.values())buttons|=p.button||0;
  pad.current.buttons=buttons;pad.current.active=pointers.current.size>0;
 };
 const release=(id:number)=>{
  const p=pointers.current.get(id);if(!p)return;pointers.current.delete(id);
  if(p.kind==='main'){pad.current.x=pad.current.y=0;pad.current.main=false;}
  if(p.kind==='c'){pad.current.cx=pad.current.cy=0;pad.current.c=false;}
  if(![...pointers.current.values()].some(other=>other.element===p.element)){
   p.element.setAttribute('aria-pressed','false');p.element.style.setProperty('--dx','0px');p.element.style.setProperty('--dy','0px');
  }
  refresh();
 };
 useEffect(()=>{
  const reset=()=>{for(const id of [...pointers.current.keys()])release(id);pad.current=neutralTouchPad();};
  const visibility=()=>{if(document.hidden)reset();};
  window.addEventListener('blur',reset);window.addEventListener('pagehide',reset);window.addEventListener('orientationchange',reset);document.addEventListener('visibilitychange',visibility);
  return()=>{reset();window.removeEventListener('blur',reset);window.removeEventListener('pagehide',reset);window.removeEventListener('orientationchange',reset);document.removeEventListener('visibilitychange',visibility);};
 },[]);
 const move=(e:PointerEvent<HTMLElement>)=>{
  const p=pointers.current.get(e.pointerId);if(!p||p.button)return;
  const rect=p.element.getBoundingClientRect(),radius=rect.width*.36;
  const dx=e.clientX-rect.left-rect.width/2,dy=e.clientY-rect.top-rect.height/2;
  const {x,y}=stickVector(dx,dy,radius),scale=Math.min(1,radius/(Math.hypot(dx,dy)||1));
  if(p.kind==='main'){pad.current.x=x;pad.current.y=y;pad.current.main=true;}
  else{pad.current.cx=x;pad.current.cy=y;pad.current.c=true;}
  p.element.style.setProperty('--dx',`${dx*scale}px`);p.element.style.setProperty('--dy',`${dy*scale}px`);
 };
 const handlers=(kind:string,button?:number)=>({
  onPointerDown:(e:PointerEvent<HTMLElement>)=>{
   e.preventDefault();
   if(!button&&[...pointers.current.values()].some(p=>p.kind===kind))return;
   e.currentTarget.setPointerCapture(e.pointerId);pointers.current.set(e.pointerId,{kind,button,element:e.currentTarget});e.currentTarget.setAttribute('aria-pressed','true');move(e);refresh();
  },onPointerMove:move,onPointerUp:(e:PointerEvent<HTMLElement>)=>release(e.pointerId),onPointerCancel:(e:PointerEvent<HTMLElement>)=>release(e.pointerId),onLostPointerCapture:(e:PointerEvent<HTMLElement>)=>release(e.pointerId)
 });
 return <div ref={deck} className="melee-touch-deck" aria-label="Melee touch controller" onContextMenu={e=>e.preventDefault()}>
  <div className="melee-touch-shoulders">{actions.slice(0,4).map(([label,help,bit])=><button key={label} className={`melee-touch-button touch-${label.toLowerCase()}`} aria-label={`${label}: ${help}`} aria-pressed="false" {...handlers(label,bit)}><span>{label}</span><small>{help}</small></button>)}</div>
  <button className="melee-touch-button touch-taunt" aria-label="D-pad up: taunt" aria-pressed="false" {...handlers('taunt',0x8)}><span>D↑</span><small>Taunt</small></button>
  <button className="melee-touch-stick touch-main" aria-label="Control stick: move" aria-pressed="false" {...handlers('main')}><i/><span>Move</span></button>
  <button className="melee-touch-stick touch-c" aria-label="C-stick: smash attacks" aria-pressed="false" {...handlers('c')}><i/><span>C-stick<small>Smash</small></span></button>
  <div className="melee-touch-actions">{actions.slice(4).map(([label,help,bit])=><button key={label} className={`melee-touch-button touch-${label.toLowerCase()}`} aria-label={`${label}: ${help}`} aria-pressed="false" {...handlers(label,bit)}><span>{label}</span><small>{help}</small></button>)}</div>
 </div>;
}
