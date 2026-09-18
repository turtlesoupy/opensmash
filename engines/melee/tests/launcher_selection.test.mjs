import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLauncherSelection} from '../launcher/launch-plan.mjs';
import schema from '../runtime/launch-options.json' with {type:'json'};
import {planLaunch} from '../runtime/web/launch-options.mjs';
const roster=[{slug:'one',target:'fox'},{slug:'two',target:'mario'}];
test('shared assignments preserve CPU and off slots before human ports',()=>{
 const settings=applyLauncherSelection(structuredClone(schema.defaults),{character:roster[0],picks:[roster[1]],portPlan:[{kind:'cpu'},{kind:'gamepad',index:2},{kind:'none'},{kind:'keyboard'}]});
 const plan=planLaunch(schema,settings,roster[0],roster,()=>0);
 assert.deepEqual(plan.ports.map(p=>p.device),['cpu','gamepad2','off','keyboard']);
 assert.equal(plan.ports[1].character,'one');assert.equal(plan.ports[3].character,'two');
 assert.equal(plan.ports[2].custom,false);
});
test('engine settings and moveset overrides survive shared device translation',()=>{
 const defaults=structuredClone(schema.defaults);defaults.ports[0].target='marth';
 const settings=applyLauncherSelection(defaults,{character:roster[0],portPlan:[{kind:'keyboard'},null,null,{kind:'none'}]});
 assert.equal(settings.ports[0].target,'marth');assert.equal(settings.stage,defaults.stage);
 assert.notEqual(settings.ports,defaults.ports);
});

test('manual opponents follow human picks even when CPUs occupy earlier ports',()=>{
 const settings=applyLauncherSelection(structuredClone(schema.defaults),{character:roster[0],picks:[roster[1]],selectionMode:'full-roster',portPlan:[{kind:'cpu'},{kind:'keyboard'},{kind:'none'},{kind:'none'}]});
 assert.equal(settings.ports[1].character,'one');assert.equal(settings.ports[0].character,'two');
});
test('full-game and character-select actions retain their meaning in Melee',()=>{
 for(const [type,mode] of [['start',4],['select',2]]){
  const settings=applyLauncherSelection(structuredClone(schema.defaults),{type,portPlan:[{kind:'keyboard'},null,null,null]});
  assert.equal(settings.mode,mode);
 }
});

test('Melee trailer fixes the cast, stage and CPU slots regardless of saved settings',()=>{
 const settings=applyLauncherSelection({...structuredClone(schema.defaults),mode:4},{meleeTrailer:true,character:{slug:'thomasdimson'},picks:[{slug:'mahatmagandhi'},{slug:'eliezeryudkowsky'}]});
 const cast=['thomasdimson','mahatmagandhi','eliezeryudkowsky'].map(slug=>({slug,target:'fox'}));
 const result=planLaunch(schema,settings,cast[0],cast,()=>0);
 assert.equal(settings.mode,0);assert.equal(settings.stage,4);
 assert.deepEqual(settings.ports.map(p=>p.character),[...cast.map(f=>f.slug),'vanilla:9']);
 assert.deepEqual(result.ports.map(p=>p.device),['keyboard','cpu','cpu','cpu']);
 assert.equal(result.ports[3].custom,false);
 assert.deepEqual(settings.ports.map(p=>p.target),['mario','sheik','young-link','auto']);
 assert.equal(new Set(result.ports.map(p=>p.fighter)).size,4);
});
