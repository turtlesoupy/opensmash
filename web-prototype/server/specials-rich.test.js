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
 score:{colors:[[40,25,60],[255,220,120]],props:[{id:'instrument',pieces:[{at:[-100,0,0],size:[5,65],mount:[],color:0,angle:0,repeat:13,step:[16,0,0]},{at:[110,-60,4],size:[20,5],mount:[],color:1,angle:0,repeat:8,step:[0,17,0]}]},{id:'note',pieces:[{at:[0,0,0],size:[14,7],mount:[],color:1,angle:0,repeat:1,step:[0,0,0]},{at:[10,18,0],size:[3,20],mount:[],color:1,angle:0,repeat:1,step:[0,0,0]}]}],moves:['neutral','up','down'].map(kind=>({kind,tracks:['torso','head'].map(joint=>({joint,keys:[{frame:12,degrees:[20,0,0]},{frame:36,degrees:[-20,0,0]}]})),hits:[{delay:0,length:8,weight:1,angle:60,radius:160,from:[200,240,0],to:[500,260,0]}],assemblies:[{prop:'instrument',keys:[{frame:4,at:[150,240,0],scale:[.7,1]},{frame:18,at:[150,240,0],scale:[1,1]},{frame:32,at:[180,240,0],scale:[.6,1]},{frame:64,at:[150,200,0],scale:[.8,1]}]}],presentation:{kind:'wave',prop:''},cueColors:[0,1],trails:[{prop:'note',hit:0,count:6,life:17,spread:100,drift:[0,3]}],velocity:[],air:{tracks:[],hitShift:[0,0,0],velocity:[]}}))}
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
  return {value:req.name==='special_description'?f.brief:{...f.score,authoringVersion:'explicit-v2'},provenance:{model:'fixture'}};
 },checkpoint:async stage=>events.push(stage)});
 assert.deepEqual(events,['principles','special_description','description','special_implementation','implementation','compiled']);
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

test('bellows keep keyboard rigid while every emission compresses the pleats',()=>{
 const f=fixture();f.score.props[0].construction='bellows';
 const m=expandRich(f).moves[0];
 const keys=m.parts.filter(p=>p.hit===-1&&p.color.join(',')==='255,246,215');
 assert.ok(keys.length>8);assert.ok(keys.every(p=>p.size[0]===23&&p.sizeTo[0]===23));
 const folds=m.parts.filter(p=>p.color.join(',')==='162,45,100');
 assert.ok(folds.some(p=>p.sizeTo[0]<p.size[0]));
 const squeeze=keys.find(p=>p.end===m.hitboxes[0].start);
 assert.ok(squeeze.to[0]<squeeze.from[0]);
});
test('particle glyphs stay connected, remain readable, and detach at their own birth',()=>{
 const f=fixture();f.score.props[1].construction='music-note';
 const m=expandRich(f).moves[0],particles=m.parts.filter(p=>p.anchorFrame>=0);
 assert.ok(particles.length>0);assert.ok(particles.every(p=>p.anchorFrame<=p.start&&p.hit===-1));
 const first=particles.filter(p=>p.start===m.hitboxes[0].start);
 assert.equal(first.length,3);assert.equal(first[0].opacity,240);
 const last=particles.filter(p=>p.anchorFrame===m.hitboxes[0].start).at(-1);
 assert.ok(last.opacityTo<first[0].opacity);
 assert.ok(particles.some(p=>p.opacityTo<p.opacity));
 assert.ok(Math.max(...first.map(p=>p.from[1]+p.size[1]))-Math.min(...first.map(p=>p.from[1]-p.size[1]))>=100);
 const later=particles.filter(p=>p.anchorFrame===m.hitboxes[0].start&&p.start===m.hitboxes[0].start+4);
 const angle=.2,dx=first[1].from[0]-first[0].from[0],dy=first[1].from[1]-first[0].from[1];
 assert.ok(Math.abs((later[1].from[0]-later[0].from[0])-(dx*Math.cos(angle)-dy*Math.sin(angle)))<1e-6);
});
test('particle anchors cannot follow future frames or detach dangerous hit cues',()=>{
 const f=fixture(),implementation=expandRich(f),args={...f,implementation,rich:true,profile:{joints:{torso:6,head:12},fkind:0,hash:'test'}};
 const p=implementation.moves[0].parts.find(p=>p.hit>=0);p.anchorFrame=0;
 assert.throws(()=>compileSet(args),/invalid particle birth anchor/);
 p.anchorFrame=p.start+1;assert.throws(()=>compileSet(args),/invalid particle birth anchor/);
});

test('general rigid mounts preserve decoration spacing while adjacent material stretches',()=>{
 const f=fixture();f.score.props[0].pieces=[
  {at:[0,0,0],size:[80,60],mount:[],color:0,angle:0,repeat:1,step:[0,0,0]},
  {at:[110,-40,4],size:[12,8],mount:[100,0],color:1,angle:0,repeat:3,step:[0,40,0]},
 ];
 const m=expandRich(f).moves[0],segment=m.parts.filter(p=>p.start===4&&p.end===18);
 const keys=segment.filter(p=>p.color[0]===255),body=segment.find(p=>p.color[0]===40);
 assert.equal(keys.length,3);assert.notEqual(body.size[0],body.sizeTo[0]);
 for(const key of keys)assert.deepEqual(key.size,key.sizeTo);
 assert.notEqual(keys[0].from[0],keys[0].to[0]);
 assert.equal(keys[1].from[1]-keys[0].from[1],keys[1].to[1]-keys[0].to[1]);
});
test('new generation forbids preset selection and retains rejected raw output without a repair call',async()=>{
 const f=fixture(),stages=[];let calls=0;
 await assert.rejects(()=>generateSet({character:f.character,profile:{joints:{torso:6,head:12},fkind:0,hash:'test'},model:async req=>{
  calls++;if(req.name==='special_description')return {value:f.brief,provenance:{model:'fixture'}};
  assert.equal(req.schema.properties.props.items.properties.construction,undefined);
  f.score.props[0].construction='bellows';return {value:{...f.score,authoringVersion:'explicit-v2'},provenance:{model:'fixture'}};
 },checkpoint:async stage=>stages.push(stage)}),/unknown field construction/);
 assert.equal(calls,2);assert.deepEqual(stages,['principles','description','implementation']);
});
test('principles and authoring contract remain frozen when resuming an existing description',async()=>{
 const f=fixture(),profile={joints:{torso:6,head:12},fkind:0,hash:'test'};let snapshot;
 await generateSet({character:f.character,profile,principlesText:'Version A: readable silhouette.',model:async req=>({value:req.name==='special_description'?f.brief:{...f.score,authoringVersion:'explicit-v2'},provenance:{model:'fixture'}}),checkpoint:async(stage,value)=>{if(stage==='principles')snapshot=value;}});
 let calls=0;
 const result=await generateSet({character:f.character,profile,brief:f.brief,policy:snapshot,principlesText:'Version B must not replace A.',model:async req=>{
  calls++;assert.ok(req.instructions.startsWith('Version A'));assert.ok(!req.instructions.includes('Version B'));return {value:{...f.score,authoringVersion:'explicit-v2'},provenance:{model:'fixture'}};
 }});
 assert.equal(calls,1);assert.equal(result.report.principles.hash,hash(snapshot.text));assert.equal(result.report.manualReview.status,'pending');
 await assert.rejects(()=>generateSet({character:f.character,profile,brief:f.brief,policy:{...snapshot,text:'tampered'},model:async()=>{throw Error('must not call');}}),/Invalid frozen principles snapshot/);
});

test('rich stages share design principles while geometry instructions stay with the implementor',async()=>{
 const f=fixture(),requests=[];let snapshot;
 await generateSet({character:f.character,profile:{joints:{torso:6,head:12},fkind:0,hash:'test'},model:async req=>{
  requests.push(req);return {value:req.name==='special_description'?f.brief:{...f.score,authoringVersion:'explicit-v2'},provenance:{model:'fixture'}};
 },checkpoint:async(stage,value)=>{if(stage==='principles')snapshot=value;}});
 const [writer,implementor]=requests;
 for(const req of requests)assert.ok(req.instructions.startsWith(snapshot.text));
 assert.ok(!snapshot.text.includes('half-extent'));
 assert.ok(!snapshot.text.includes('mount='));
 assert.ok(!writer.instructions.includes('mount='));
 assert.ok(!writer.instructions.includes('half-extent'));
 assert.ok(!writer.instructions.includes('Production visual baseline'));
 assert.ok(implementor.instructions.includes('mount=[]'));
 assert.ok(implementor.instructions.includes('half-width'));
 assert.deepEqual(implementor.input.brief,f.brief);
 assert.equal(requests.length,2);
});

test('body-only moves compile without props, particles or synthetic hit effects',()=>{
 const f=fixture(),profile={joints:{torso:6,head:12},fkind:0,hash:'test'};
 const original=compileRich({...f,profile});f.score.props=[];
 for(const m of f.score.moves){m.presentation={kind:'body',prop:''};m.assemblies=[];m.trails=[];}
 const packet=compileRich({...f,profile});
 packet.sets[0].moves.forEach((m,i)=>{
  assert.deepEqual(m.parts,[]);assert.equal(m.dangerSource,'body');
  assert.deepEqual(m.hitboxes,original.sets[0].moves[i].hitboxes);
  assert.deepEqual(m.tracks,original.sets[0].moves[i].tracks);
 });
 const impl=expandRich(f);delete impl.moves[0].dangerSource;
 assert.throws(()=>compileSet({...f,profile,implementation:impl,rich:true}),/missing danger cue/);
});
test('weapon presentation follows collision without forced waves or particles',()=>{
 const f=fixture(),profile={joints:{torso:6,head:12},fkind:0,hash:'test'};
 for(const m of f.score.moves){m.presentation={kind:'prop',prop:'note'};m.assemblies=[];m.trails=[];}
 for(const m of compileRich({...f,profile}).sets[0].moves){
  assert.equal(m.parts.length,2);assert.equal(m.dangerSource,undefined);
  for(const p of m.parts){assert.equal(p.hit,0);assert.equal(p.start,m.hitboxes[0].start);assert.equal(p.end,m.hitboxes[0].end);assert.equal(p.anchorFrame,undefined);}
 }
 f.score.moves[0].presentation.prop='missing';assert.throws(()=>compileRich({...f,profile}),/unknown prop/);
});
test('old rich scores retain historical effects when presentation is omitted',()=>{
 const f=fixture(),expected=expandRich(f);
 for(const m of f.score.moves)delete m.presentation;
 assert.deepEqual(expandRich(f),expected);
});

test('explicit geometry keeps authored assembly lifetimes and prop and particle sizes',()=>{
 const f=fixture();f.score.authoringVersion='explicit-v2';
 f.score.props[0].pieces=[{at:[0,0,0],size:[12,8],mount:[],color:0,angle:0,repeat:1,step:[0,0,0]}];
 for(const m of f.score.moves)m.assemblies[0].keys=[{frame:16,at:[100,200,0],scale:[1,1]},{frame:24,at:[110,200,0],scale:[1,1]}];
 const x=expandRich(f).moves[0],assembly=x.parts.filter(p=>p.hit===-1&&p.anchorFrame===undefined);
 assert.equal(assembly.length,1);assert.equal(assembly[0].start,16);assert.equal(assembly[0].end,24);
 assert.deepEqual(assembly[0].size,[12,8]);assert.deepEqual(assembly[0].sizeTo,[12,8]);
 const glyph=x.parts.filter(p=>p.anchorFrame!==undefined);
 assert.deepEqual(glyph[0].size,[14,7]);assert.deepEqual(glyph[1].size,[3,20]);
 delete f.score.authoringVersion;
 const legacy=expandRich(f).moves[0];
 assert.ok(legacy.parts.some(p=>p.anchorFrame!==undefined&&p.size[0]>14));
 assert.ok(legacy.parts.some(p=>p.anchorFrame===undefined&&p.hit===-1&&p.start<16));
});
test('explicit weapon setup and recovery do not duplicate active geometry in either context',()=>{
 const f=fixture();f.score.authoringVersion='explicit-v2';
 for(const m of f.score.moves){
  m.presentation={kind:'prop',prop:'note'};m.trails=[];
  m.assemblies=[{prop:'note',keys:[{frame:0,at:[200,240,0],scale:[1,1]},{frame:20,at:[200,240,0],scale:[1,1]}]},
   {prop:'note',keys:[{frame:28,at:[500,260,0],scale:[1,1]},{frame:44,at:[500,260,0],scale:[1,1]}]}];
 }
 const x=compileRich({...f,profile:{joints:{torso:6,head:12},fkind:0,hash:'test'}});
 for(const m of x.sets[0].moves){
  const h=m.hitboxes[0];
  for(let frame=h.start;frame<h.end;frame++){
   const visible=m.parts.filter(p=>frame>=p.start&&frame<p.end);
   assert.equal(visible.length,2);assert.ok(visible.every(p=>p.hit===0));
  }
 }
 f.score.moves[0].assemblies[0].keys[1].frame=21;
 assert.throws(()=>expandRich(f),/supporting weapon assembly overlaps active hit/);
});
test('explicit aerial shift keeps supporting geometry and collision together without moving the body',()=>{
 const f=fixture();f.score.authoringVersion='explicit-v2';
 const before=expandRich(f),shift=[40,90,3];for(const m of f.score.moves)m.air.hitShift=shift;
 const after=expandRich(f);
 for(let j=0;j<3;j++)assert.deepEqual(after.moves[j],before.moves[j]);
 for(let j=3;j<6;j++){
  const a=before.moves[j],b=after.moves[j];assert.deepEqual(a.tracks,b.tracks);
  assert.deepEqual(b.hitboxes[0].offset,a.hitboxes[0].offset.map((x,k)=>x+shift[k]));
  a.parts.forEach((p,k)=>{
   if(p.hit>=0)assert.deepEqual(b.parts[k],p); // Bound geometry inherits the hit shift once.
   else for(const field of ['from','to'])p[field].forEach((x,n)=>assert.ok(Math.abs(b.parts[k][field][n]-x-shift[n])<1e-9));
  });
 }
});
test('generation report exposes timing normalization and final ground and air collision',async()=>{
 const f=fixture();f.score.authoringVersion='explicit-v2';
 for(const m of f.score.moves)m.hits=[{...m.hits[0],delay:17,length:20},{...m.hits[0],delay:25,length:40}];
 const result=await generateSet({character:f.character,profile:{joints:{torso:6,head:12},fkind:0,hash:'test'},brief:f.brief,
  model:async()=>({value:f.score,provenance:{model:'fixture'}})});
 assert.equal(result.report.compiler.version,'explicit-v2');
 for(const t of result.report.compiler.transformations){assert.equal(t.firstDelayRemoved,17);assert.deepEqual(t.overlapsClipped,[0]);assert.ok(t.actionScale<1);}
 assert.equal(result.report.compiler.contexts.length,6);
 for(const [k,c] of result.report.compiler.contexts.entries()){
  const m=result.packet.sets[0].moves[k];assert.deepEqual(c.hits.map(h=>[h.start,h.end]),m.hitboxes.map(h=>[h.start,h.end]));
 }
 assert.equal(result.report.compiler.visualAlignment,'pending-human-review');
});


test('uploader move direction reaches the writer and frozen description reaches the implementor',async()=>{
 const f=fixture(),direction='A gardener with vine whips and a watering can',requests=[];
 await generateSet({character:{...f.character,moveDirection:direction},profile:{joints:{torso:6,head:12},fkind:0,hash:'test'},model:async req=>{
  requests.push(req);return {value:req.name==='special_description'?f.brief:{...f.score,authoringVersion:'explicit-v2'},provenance:{model:'fixture'}};
 }});
 assert.equal(requests.length,2);
 assert.equal(requests[0].input.character.moveDirection,direction);
 assert.ok(requests[0].instructions.includes('rather than inventing a biography'));
 assert.deepEqual(requests[1].input.brief,f.brief);
 assert.ok(requests[1].instructions.includes('do not redesign them from the original direction'));
});
