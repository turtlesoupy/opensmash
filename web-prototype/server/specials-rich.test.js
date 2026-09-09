import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {SLOTS,rigProfile,compileSet,hash} from './specials/contract.js';
import {expandRich,compileRich} from './specials/rich.js';
import {generateSet} from './specials/generate.js';
const root=path.resolve(import.meta.dirname,'../..');
const fixture=()=>({
 character:{id:'fixture'},
 brief:{identity:'Theatrical musician',palette:[255,220,120],moves:SLOTS.map(slot=>({slot,name:slot,signature:'Pleated instrument',anticipation:'Pull',action:'Squeeze',recovery:'Fold',groundAirDifference:'Tuck legs',counterplay:'Punish recovery',startup:slot.endsWith('air')?12:20,duration:slot.endsWith('air')?70:80,damage:12}))},
 score:{colors:[[40,25,60],[255,220,120]],props:[{id:'instrument',pieces:[{at:[-100,0,0],size:[5,65],color:0,angle:0,repeat:13,step:[16,0,0]},{at:[110,-60,4],size:[20,5],color:1,angle:0,repeat:8,step:[0,17,0]}]},{id:'note',pieces:[{at:[0,0,0],size:[14,7],color:1,angle:0,repeat:1,step:[0,0,0]},{at:[10,18,0],size:[3,20],color:1,angle:0,repeat:1,step:[0,0,0]}]}],moves:['neutral','up','down'].map(kind=>({kind,tracks:['torso','head'].map(joint=>({joint,keys:[{frame:12,degrees:[20,0,0]},{frame:36,degrees:[-20,0,0]}]})),hits:[{delay:0,length:8,weight:1,angle:60,radius:160,from:[200,240,0],to:[500,260,0]}],assemblies:[{prop:'instrument',keys:[{frame:4,at:[150,240,0],scale:[.7,1]},{frame:18,at:[150,240,0],scale:[1,1]},{frame:32,at:[180,240,0],scale:[.6,1]},{frame:64,at:[150,200,0],scale:[.8,1]}]}],cueColors:[0,1],trails:[{prop:'note',hit:0,count:6,life:17,spread:100,drift:[0,3]}],velocity:[],air:{tracks:[],hitShift:[0,0,0],velocity:[]}}))}
});
test('compact repeated geometry yields detailed six-context packets with bounded peaks and identical replay',async()=>{
 const args={...fixture(),profile:await rigProfile(root)},before=JSON.stringify(args);
 const expanded=expandRich(args),packet=compileRich(args);
 assert.equal(JSON.stringify(args),before);assert.deepEqual(packet,compileRich(args));
 assert.deepEqual(packet,compileSet({...args,implementation:expanded,rich:true}));
 for(const m of packet.sets[0].moves){
  assert.equal(m.version,4);assert.ok(m.parts.length>100);
  assert.ok(m.parts.some(p=>p.from[2]>=120));
  assert.equal(m.parts.filter(p=>p.hit===0).length,34);
  assert.ok(m.parts.some(p=>p.start>m.hitboxes[0].end&&p.opacity<205));
  assert.ok(m.parts.some(p=>p.sizeTo[0]!==p.size[0]));
  for(let frame=0;frame<m.duration;frame++)assert.ok(m.parts.filter(p=>frame>=p.start&&frame<p.end).length<=224);
 }
});
test('rich authoring is the default two-call upload pipeline with frozen description',async()=>{
 const f=fixture(),events=[],profile=await rigProfile(root);
 const result=await generateSet({character:f.character,profile,model:async req=>{
  events.push(req.name);if(req.name==='special_implementation')assert.equal(req.input.briefHash,hash(f.brief));
  return {value:req.name==='special_description'?f.brief:f.score,provenance:{model:'fixture'}};
 },checkpoint:async stage=>events.push(stage)});
 assert.deepEqual(events,['special_description','description','special_implementation','implementation','compiled']);
 assert.equal(result.report.judges,0);assert.equal(result.report.format,'rich');assert.equal(result.packet.sets[0].moves[0].version,4);
});
test('rich effects compile for all twelve supported rigs',async()=>{
 for(const target of ['mario','fox','donkey','samus','luigi','link','yoshi','captain','kirby','pikachu','purin','ness']){
  const f=fixture(),profile=await rigProfile(root,target);
  for(const m of f.score.moves)m.tracks.forEach((t,k)=>t.joint=Object.keys(profile.joints)[k]);
  assert.equal(compileRich({...f,profile}).sets[0].moves.length,6);
 }
});
for(const [name,mutate] of [
 ['missing palette',f=>f.score.moves[0].cueColors[0]=7],
 ['oversized prop',f=>f.score.props[0].pieces.push(...Array(4).fill(f.score.props[0].pieces[0]))],
 ['unknown glyph',f=>f.score.moves[0].trails[0].prop='missing'],
 ['reversed timeline',f=>f.score.moves[0].assemblies[0].keys[2].frame=8],
 ['visual overflow',f=>{f.score.props[0].pieces.push({...f.score.props[0].pieces[0],repeat:16});const m=f.score.moves[0];m.assemblies.push(...Array(3).fill(m.assemblies[0]));m.trails=Array(3).fill({...m.trails[0],count:10});}],
])test(`rejects ${name} without model repair`,async()=>{const f=fixture();mutate(f);assert.throws(()=>compileRich({...f,profile:{joints:{torso:6,head:12},fkind:0,hash:'test'}}));});

test('compiler anchors relative beats and pads signature prop without model arithmetic',()=>{
 const f=fixture();for(const m of f.score.moves){m.hits[0].delay=17;m.assemblies[0].keys=[{frame:19,at:[150,240,0],scale:[1,1]},{frame:22,at:[150,240,0],scale:[.7,1]}];}
 const x=expandRich(f);assert.equal(x.moves[0].hitboxes[0].start,20);
 assert.ok(x.moves[0].parts.some(p=>p.hit===-1&&p.start===12));
 assert.ok(x.moves[0].parts.some(p=>p.hit===-1&&p.end>=36));
});

test('action rhythm and poses fit both contexts without overlapping native hits',()=>{
 const f=fixture();f.brief.moves[3].duration=40;f.brief.moves[3].startup=10;
 f.score.moves[0].hits=[{...f.score.moves[0].hits[0],delay:0,length:10},{...f.score.moves[0].hits[0],delay:8,length:8},{...f.score.moves[0].hits[0],delay:35,length:10}];
 const x=expandRich(f);
 for(const m of [x.moves[0],x.moves[3]]){
  const b=f.brief.moves.find(b=>b.slot===m.slot);assert.ok(m.hitboxes.at(-1).end<=b.duration-12);
  m.hitboxes.forEach((h,k)=>{if(k)assert.ok(h.start>=m.hitboxes[k-1].end);});
 }
 assert.ok(x.moves[0].tracks[0].keys[2].frame<36);
});

test('retained real model outputs compile without edits and stay deterministic',async()=>{
 const {readFile}=await import('node:fs/promises');
 for(const run of ['weird-al-v3','lincoln-v2']){
  const base=path.join(root,'experiments/special-sets/rich-rollout/attempts',run);
  const input=JSON.parse(await readFile(path.join(base,'input.json'),'utf8'));
  const {brief}=JSON.parse(await readFile(path.join(base,'description.json'),'utf8'));
  const {implementation:score}=JSON.parse(await readFile(path.join(base,'implementation.json'),'utf8'));
  const before=JSON.stringify({brief,score});
  const packet=compileRich({...input,brief,score});
  assert.equal(packet.sets[0].moves.length,6);assert.equal(JSON.stringify({brief,score}),before);
  assert.equal(hash(packet),hash(compileRich({...input,brief,score})));
 }
});

test('standard cost accounting includes cache writes and all output tokens',async()=>{
 const {estimateGenerationUsd}=await import('./specials/pricing.js');
 assert.equal(estimateGenerationUsd({model:'gpt-5.6-luna',usage:{input_tokens:1000,input_tokens_details:{cached_tokens:500,cache_write_tokens:100},output_tokens:300}}),.000475);
 assert.equal(estimateGenerationUsd({model:'unknown',usage:{input_tokens:10,output_tokens:10}}),null);
 assert.equal(estimateGenerationUsd({model:'gpt-5.6-luna',serviceTier:'priority',usage:{input_tokens:10,output_tokens:10}}),null);
});
