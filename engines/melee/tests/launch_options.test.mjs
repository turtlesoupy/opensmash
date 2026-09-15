import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planLaunch} from '../runtime/web/launch-options.mjs';
const schema=JSON.parse(readFileSync(new URL('../runtime/launch-options.json',import.meta.url)));
const roster=[{slug:'alan',target:'mario'},{slug:'einstein',target:'mario'},{slug:'fox',target:'fox'}];
const fresh=()=>structuredClone(schema.defaults);
test('all five modes preserve numeric launch contract',()=>{
 for(const mode of schema.modes){const s=fresh();s.mode=mode.id;s.ports[1].character='vanilla:12';s.ports[2]={device:'off',character:'vanilla:2'};s.ports[3]={device:'off',character:'vanilla:9'};const p=planLaunch(schema,s,roster[0],roster);assert.equal(p.mode,mode.id);assert.deepEqual(p.packedPorts,[8,268,770,777]);}
});
test('default lineup is the pick, a random Melee fighter and two random custom opponents',()=>{
 const s=fresh();assert.deepEqual(s.ports.map(p=>p.character),['selected','random:vanilla','random','random']);
 const p=planLaunch(schema,s,roster[0],roster,()=>0);
 assert.deepEqual(p.ports.map(x=>x.character),['alan','vanilla:0','einstein','fox']);
 assert.deepEqual(p.ports.map(x=>x.device),['keyboard','cpu','cpu','cpu']);
 assert.deepEqual(p.packedPorts,[8,256,8|256|(1<<16),2|256]);
 assert.deepEqual(p.costumes.map(x=>x.character),['alan','einstein','fox']);
});
test('random opponents never duplicate the player or each other while the roster allows',()=>{
 const wide=[...roster,{slug:'ada',target:'fox'},{slug:'bob',target:'link'}];
 for(let i=0;i<50;i++){const p=planLaunch(schema,fresh(),wide[0],wide,()=>i/50);const slugs=p.ports.filter(x=>x.custom).map(x=>x.character);assert.equal(new Set(slugs).size,slugs.length);assert(schema.fighters.some(f=>'vanilla:'+f.id===p.ports[1].character));}
 // A one-character roster still launches: the random picks fall back to the only fighter.
 const lone=[roster[0]];const p=planLaunch(schema,fresh(),lone[0],lone,()=>0);assert.deepEqual(p.ports.map(x=>x.character),['alan','vanilla:0','alan','alan']);
});
test('random picks on an unused port do not consume costumes',()=>{
 const s=fresh();s.ports[2].device='off';s.ports[3].device='off';
 const p=planLaunch(schema,s,roster[0],roster,()=>0);assert.deepEqual(p.costumes.map(x=>x.character),['alan']);
});
test('custom fighters sharing a moveset get distinct costume exports',()=>{
 const s=fresh();s.ports[1].character='einstein';s.ports[2]={device:'cpu',character:'vanilla:8'};s.ports[3]={device:'cpu',character:'alan'};
 const p=planLaunch(schema,s,roster[0],roster);assert.deepEqual(p.ports.map(x=>x.color),[1,2,0,1]);assert.deepEqual(p.costumes.map(x=>x.filename),['PlMrYe.dat','PlMrBk.dat']);
});
test('reject duplicate controllers, invalid settings and one-player FFA',()=>{
 const s=fresh();s.ports[1].device='keyboard';assert.throws(()=>planLaunch(schema,s,roster[0],roster),/only one/);
 for(const port of s.ports.slice(1))port.device='off';assert.throws(()=>planLaunch(schema,s,roster[0],roster),/at least two/);
 s.ports[1].device='cpu';s.stage=21;assert.throws(()=>planLaunch(schema,s,roster[0],roster),/Invalid/);
 s.stage=31;s.level=10;assert.throws(()=>planLaunch(schema,s,roster[0],roster),/Invalid/);
});
test('random stage never selects unused stage IDs',()=>{
 const s=fresh();assert.equal(s.stage,-1);
 for(let i=0;i<100;i++){const p=planLaunch(schema,s,roster[0],roster,()=>i/100);assert(schema.stages.some(x=>x.id===p.stage));assert(![-1,21,26].includes(p.stage));}
});

test('an explicitly saved stage overrides the random default',()=>{
 const s={...fresh(),stage:31};
 assert.equal(planLaunch(schema,s,roster[0],roster,()=>0).stage,31);
});

test('every retarget preserves the selected identity and selects its own costume',()=>{
 for(const target of schema.targets){
  const s=fresh();s.ports[0].target=target.slug;
  const p=planLaunch(schema,s,roster[0],roster,()=>0);
  assert.equal(p.ports[0].fighter,target.fighter);
  assert.equal(p.ports[0].character,roster[0].slug);
  assert.equal(p.costumes[0].target,target.slug);
  assert.equal(p.costumes[0].filename,schema.costumes[target.fighter][p.ports[0].color].filename);
 }
 assert.equal(schema.targets.length,26);
});
test('Ice Climbers always prepares Nana in the same costume color',()=>{
 const s=fresh();s.ports[0].target='popo';const p=planLaunch(schema,s,roster[0],roster,()=>0);
 const leader=p.costumes.find(c=>c.target==='popo'),partner=p.costumes.find(c=>c.target==='nana');
 assert(partner.companion);assert.equal(partner.character,leader.character);assert.equal(partner.color,leader.color);
 assert(partner.filename.startsWith('PlNn'));
});
test('unknown retargets fail before preparation',()=>{
 const s=fresh();s.ports[0].target='../bad';assert.throws(()=>planLaunch(schema,s,roster[0],roster),/valid fighter/);
});
test('Zelda and Sheik reserve colors together and prepare both transformations',()=>{
 const s=fresh();s.ports=[{device:'keyboard',character:'selected',target:'zelda'},{device:'cpu',character:'einstein',target:'sheik'},{device:'cpu',character:'vanilla:18'},{device:'off',character:'vanilla:2'}];
 const p=planLaunch(schema,s,roster[0],roster);
 assert.deepEqual(p.ports.map(x=>x.color),[1,2,0,0]);
 assert.equal(p.costumes.length,4);
 for(const character of ['alan','einstein']) {
  const pair=p.costumes.filter(c=>c.character===character);
  assert.deepEqual(new Set(pair.map(c=>c.target)),new Set(['zelda','sheik']));
  assert.equal(pair[0].color,pair[1].color);
  for(const c of pair)assert.equal(c.fighter,schema.targets.find(t=>t.slug===c.target).fighter);
 }
});
test('expanded catalog launches every grid default with random opponents',()=>{
 const catalog=JSON.parse(readFileSync(new URL('../web/public/catalog.json',import.meta.url)));
 assert.equal(new Set(catalog.map(f=>f.target)).size,26);
 for(const selected of catalog) {
  for(const random of [()=>0,()=>0.12,()=>0.5,()=>0.999]) {
   const p=planLaunch(schema,fresh(),selected,catalog,random);
   assert.equal(p.ports[0].target,selected.target);
   assert.equal(p.costumes[0].target,selected.target);
  }
 }
});
