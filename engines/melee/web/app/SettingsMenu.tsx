import {useState} from 'react';
import {desktop} from '@/lib/desktop';
import type {Settings} from '@/lib/launch';
import {names, type Fighter} from './page';
import LaunchSettings from './LaunchSettings';
import Controls from './Controls';
import BootScreen from './BootScreen';
export default function SettingsMenu({value,onChange,roster,target,onTarget,onReady,onClose}:{value:Settings;onChange:(s:Settings)=>void;roster:Fighter[];target:string;onTarget:(s:string)=>void;onReady:(ready:boolean)=>void;onClose:()=>void}) {
 const [page,setPage]=useState<'main'|'gameplay'|'controllers'|'controls'|'roster'|'disc'>('main');
 const titles={main:'',gameplay:'Gameplay Options',controllers:'Players & Controllers',controls:'Controls',roster:'Roster',disc:'Game Disc'};
 return <section className="settings-page">
  {page==='main'?<div className="settings-menu">
   {(['gameplay','controllers','controls','roster','disc'] as const).map(key=><button className="settings-menu-button" key={key} onClick={()=>setPage(key)}>{titles[key]}</button>)}
   {desktop()&&<button className="settings-menu-button" onClick={()=>void desktop()!.fullscreen()}>Toggle Fullscreen</button>}
   <button className="settings-menu-button" onClick={onClose}>Done</button>
  </div>:<>
   <h2 className="settings-subheading">{titles[page]}</h2>
   {page==='gameplay'&&<LaunchSettings section="gameplay" value={value} onChange={onChange} roster={roster}/>}
   {page==='controllers'&&<><p className="settings-subtitle">Connect a controller for multiplayer.</p><LaunchSettings section="controllers" value={value} onChange={onChange} roster={roster}/></>}
   {page==='disc'&&<BootScreen onReady={onReady} onCleared={onClose}/>}
   {page==='controls'&&<Controls/>}
   {page==='roster'&&<label className="moveset-filter">Melee moveset<select value={target} onChange={e=>onTarget(e.target.value)}><option value="all">All fighters</option>{Object.entries(names).map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>}
   <button className="settings-menu-button settings-back-button" onClick={()=>setPage('main')}>Back</button>
  </>}
 </section>;
}
