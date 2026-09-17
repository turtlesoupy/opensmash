import {preferences} from '@/lib/desktop';
import schema from '../../runtime/launch-options.json';
import {planLaunch} from '../../runtime/web/launch-options.mjs';
import type {Fighter} from './fighter';
export {schema};
export type Settings=Omit<typeof schema.defaults,'ports'> & {ports:(typeof schema.defaults.ports[number] & {target?:string})[]};
export const defaults=()=>structuredClone(schema.defaults);
// The alpha shipped with a single Peach CPU on Battlefield as the default; saved copies of
// those opponents follow the new random lineup while keeping player 1's own controller.
const legacyOpponents=JSON.stringify([{device:'cpu',character:'vanilla:12'},{device:'off',character:'vanilla:2'},{device:'off',character:'vanilla:9'}]);
export function loadSettings():Settings {try{
 const saved=JSON.parse(preferences.getItem('melee-launch-v1')||'{}');
 {
  const requested=new URLSearchParams(location.search).get('moveset');
  saved.ports=(saved.ports||defaults().ports).map((p:any)=>({...p,target:requested&&schema.targets.some(t=>t.slug===requested)?requested:p.target||'auto'}));
 }
 if(Array.isArray(saved.ports)&&JSON.stringify(saved.ports.slice(1))===legacyOpponents){
  saved.ports=[saved.ports[0],...defaults().ports.slice(1)];
  if(saved.stage===31)delete saved.stage;
 }
 return {...defaults(),...saved};
}catch{return defaults();}}
export function plan(settings:Settings,selected:Fighter,roster:Fighter[]){return planLaunch(schema,settings,selected,roster);}
