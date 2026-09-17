import {useState} from 'react';
import type {Fighter} from '../lib/fighter';
import {schema,type Settings} from '@/lib/launch';
import {renderWidths,resolveRenderWidth} from '../lib/render-resolution.mjs';
import {desktop} from '../lib/desktop';
function CharacterInput({value,onChange,choices}:{value:string,onChange:(value:string)=>void,choices:{id:string,label:string}[]}) {
 const label=choices.find(c=>c.id===value)?.label ?? value;
 const [draft,setDraft]=useState<string|null>(null);
 return <input list="launch-characters" value={draft ?? label} onFocus={()=>setDraft(label)} onBlur={()=>setDraft(null)} onChange={e=>{
   setDraft(e.target.value);
   const match=choices.find(c=>c.label.toLocaleLowerCase()===e.target.value.toLocaleLowerCase() || c.id===e.target.value);
   if(match) onChange(match.id);
 }}/>;
}
export default function LaunchSettings({value,onChange,roster,section='all'}:{section?:'all'|'gameplay'|'controllers',value:Settings,onChange:(s:Settings)=>void,roster:Fighter[]}) {
 const choices=[{id:'selected',label:'Use roster selection'},{id:'random',label:'Random custom character'},{id:'random:vanilla',label:'Random Melee fighter'},...schema.fighters.map(f=>({id:'vanilla:'+f.id,label:f.label+' (Melee)'})),...roster.map(f=>({id:f.slug,label:f.name}))];
 const set=(key:string,n:number)=>onChange({...value,[key]:n});
 const port=(index:number,key:string,v:string)=>onChange({...value,ports:value.ports.map((p,i)=>i===index?{...p,[key]:v}:p)});
 return <section className="launch-settings" aria-label="Launch settings">{section!=='controllers'&&<div className="launch-rules">
 <label>Game mode<select value={value.mode} onChange={e=>set('mode',+e.target.value)}>{schema.modes.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
 <label>Stage<select value={value.stage} onChange={e=>set('stage',+e.target.value)}>{schema.stages.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
 <label>CPU level<input type="number" min="1" max="9" value={value.level} onChange={e=>set('level',+e.target.value)}/></label>
 <label>Stocks<input type="number" min="1" max="99" value={value.stocks} onChange={e=>set('stocks',+e.target.value)}/></label>
 <label>Minutes (0 = unlimited)<input type="number" min="0" max="99" value={value.minutes} onChange={e=>set('minutes',+e.target.value)}/></label>
 {!desktop()&&<label>Render resolution<select value={value.renderWidth||0} onChange={e=>set('renderWidth',+e.target.value)}><option value={0}>Automatic ({resolveRenderWidth(0)} × {resolveRenderWidth(0)*3/4})</option>{renderWidths.map(width=><option key={width} value={width}>{width} × {width*3/4}</option>)}</select><small>Lower resolutions improve performance. Applies to the next match.</small></label>}
 </div>}{section!=='gameplay'&&<div className="launch-ports">{value.ports.map((p,i)=><fieldset key={i}><legend>Player {i+1}</legend><label>Controller<select value={p.device} onChange={e=>port(i,'device',e.target.value)}>{['keyboard','gamepad0','gamepad1','gamepad2','gamepad3','cpu','off'].map(d=><option key={d} value={d}>{d==='keyboard'?'Keyboard':d==='cpu'?'CPU':d==='off'?'Off':'Gamepad '+(+d.slice(-1)+1)}</option>)}</select></label><label>Character<CharacterInput value={p.character} onChange={v=>port(i,'character',v)} choices={choices}/></label><label>Moveset<select value={p.target || "auto"} onChange={e=>port(i,"target",e.target.value)}><option value="auto">Original assignment</option>{schema.targets.map(t=><option key={t.slug} value={t.slug}>{t.label}</option>)}</select></label></fieldset>)}</div>}
 <datalist id="launch-characters">{choices.map(c=><option key={c.id} value={c.label}/>)}</datalist>
 </section>;
}
