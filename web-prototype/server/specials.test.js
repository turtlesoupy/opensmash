import {videoResponse} from './specials/video.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SLOTS,rigProfile,compileSet,hash} from './specials/contract.js';
import {generateSet} from './specials/generate.js';
import {createSpecialJobs} from './specials/jobs.js';
import {createJobDatabase} from './job-database.js';
import {createObjectStore} from './object-store.js';
const repo=path.resolve(import.meta.dirname,'../..');
const fixture=()=>({
 brief:{identity:'A theatrical musician.',palette:[255,190,70],moves:SLOTS.map(slot=>({slot,name:`Polka ${slot}`,signature:'Accordion',anticipation:'Compress',action:'Expand',recovery:'Fold',groundAirDifference:'Tuck in air',counterplay:'Punish recovery',damage:10,startup:12,duration:48}))},
 implementation:{moves:SLOTS.map((slot,i)=>({slot,tracks:['torso','head'].map(joint=>({joint,keys:[{frame:0,degrees:[0,0,0]},{frame:12,degrees:[20,0,0]},{frame:48,degrees:[0,0,0]}]})),hitboxes:[{start:12,end:18,damage:10,angle:60,base:40,growth:80,radius:100,offset:[180,150,0],to:[260,150,0]}],parts:[{hit:0,start:12,end:18,from:[0,0,0],to:[0,0,0],size:[80,60],spin:0,color:[255,190,70]}],motion:{frame:i%3===1?12:-1,velocity:i%3===1?[10,70]:[0,0]}}))}
});
const character={id:'char-1',name:'A new uploaded musician',bundleHash:'test'};
test('all twelve rig profiles compile all six contexts without character branches',async()=>{
 for(const target of ['mario','fox','donkey','samus','luigi','link','yoshi','captain','kirby','pikachu','purin','ness']) {
  const profile=await rigProfile(repo,target),f=fixture();
  for(const move of f.implementation.moves) move.tracks.forEach((t,i)=>t.joint=Object.keys(profile.joints)[i]);
  const packet=compileSet({...f,profile,character});assert.equal(packet.sets[0].moves.length,6);
  assert.equal(new Set(Object.values(profile.joints)).size,Object.keys(profile.joints).length);
 }
});
test('incomplete sets, drifted contract, pose discontinuities and disconnected cues fail closed',async()=>{
 const profile=await rigProfile(repo);
 const bad=[f=>f.implementation.moves.pop(),f=>f.implementation.moves[1].slot=SLOTS[0],
  f=>f.implementation.moves[0].hitboxes[0].damage=9,f=>f.implementation.moves[0].parts[0].end=20,
  f=>f.implementation.moves[0].tracks[0].keys[0].degrees[0]=4,
  f=>f.implementation.moves[4].motion.velocity[1]=0,f=>f.implementation.moves[0].tracks[0].joint='invented',
  f=>f.implementation.moves[0].hitboxes[0].radius=NaN];
 for(const mutate of bad){const f=fixture();mutate(f);assert.throws(()=>compileSet({...f,profile,character}));}
});
test('two stages checkpoint description before implementation; no judge or repair call',async()=>{
 const f=fixture(),events=[];const profile=await rigProfile(repo);
 const result=await generateSet({format:'full',character,profile,model:async req=>{
  events.push(req.name);if(req.name==='special_implementation') assert.equal(req.input.briefHash,hash(f.brief));
  return {value:req.name==='special_description'?f.brief:f.implementation,provenance:{model:'test'}};
 },checkpoint:async stage=>events.push(stage)});
 assert.deepEqual(events,['special_description','description','special_implementation','implementation','compiled']);
 assert.equal(result.report.judges,0);assert.equal(result.report.runtimeValidated,false);
});
async function service(t,{validate,model}={}) {
 const dir=await mkdtemp(path.join(os.tmpdir(),'special-jobs-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=createObjectStore({appRoot:dir});await store.init();
 const bundleFile=path.join(dir,'character.osb');await writeFile(bundleFile,'fixture-bundle');
 const bundle=await store.putFile('characters/test.osb',bundleFile,{public:false});
 const database=createJobDatabase({jobsRoot:path.join(dir,'jobs')});
 let calls=0;
 const jobs=createSpecialJobs({authoringFormat:'full',repoRoot:repo,jobsRoot:path.join(dir,'jobs'),jobDatabase:database,objectStore:store,dispatcher:{driver:'local'},
  resolveCharacter:async(id,owner)=>owner==='owner'?{character:{id,name:'Uploaded musician'},bundle,target:'mario'}:null,
  model:model||(async req=>{calls++;return {value:req.name==='special_description'?fixture().brief:fixture().implementation,provenance:{model:'test'}};}),
  validator:validate||(async()=>({status:'ready',runtimeValidated:true,contexts:SLOTS.map(slot=>({slot,passed:true}))}))});
 await jobs.init();t.after(()=>jobs.close());return {jobs,calls:()=>calls,database};
}
test('idempotent submit, owner isolation, and readiness requires six runtime results',async t=>{
 const {jobs,calls}=await service(t);
 const [a,b]=await Promise.all([jobs.create('char1','owner','request-123'),jobs.create('char1','owner','request-123')]);
 assert.equal(a.id,b.id);await jobs.settled();assert.equal(calls(),2);
 const ready=await jobs.get(a.id,'owner');assert.equal(ready.ready,true);
 await assert.rejects(()=>jobs.get(a.id,'intruder'),/not found/);
 await assert.rejects(()=>jobs.readyPackage(a.id,'different-character'),/not found/);
 const {packet}=await jobs.readyPackage(a.id,'char1');assert.equal(packet.sets[0].moves.length,6);
});
test('partial validation cannot publish or equip',async t=>{
 const {jobs}=await service(t,{validate:async()=>({status:'ready',runtimeValidated:true,contexts:[{passed:true}]})});
 const job=await jobs.create('char1','owner','request-partial');await jobs.settled();
 assert.equal((await jobs.get(job.id,'owner')).status,'failed');
 await assert.rejects(()=>jobs.readyPackage(job.id,'char1'),/not found/);
});
test('cancel during model call fences stale completion',async t=>{
 let entered,release;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const {jobs}=await service(t,{model:async()=>{entered();await wait;return {value:fixture().brief,provenance:{}};}});
 const job=await jobs.create('char1','owner','request-cancel');await started;
 await jobs.cancel(job.id,'owner');release();await jobs.settled();
 assert.equal((await jobs.get(job.id,'owner')).status,'cancelled');
 await assert.rejects(()=>jobs.readyPackage(job.id,'char1'),/not found/);
});
test('runtime retry reuses compiled set and frozen description',async t=>{
 let runs=0;const {jobs,calls}=await service(t,{validate:async()=>{
  if(++runs===1)throw new Error('temporary validation worker failure');
  return {status:'ready',runtimeValidated:true,contexts:SLOTS.map(slot=>({slot,passed:true}))};
 }});
 const job=await jobs.create('char1','owner','request-retry');await jobs.settled();
 const frozen=(await jobs.get(job.id,'owner')).description;
 await jobs.retry(job.id,'owner');await jobs.settled();
 assert.equal(calls(),2);assert.deepEqual((await jobs.get(job.id,'owner')).description,frozen);
 assert.equal((await jobs.get(job.id,'owner')).ready,true);
});

test('preview URLs support mobile MP4 range requests',()=>{
 const bytes=Buffer.from('0123456789');
 assert.equal(videoResponse(bytes).status,200);
 assert.equal(videoResponse(bytes,'bytes=0-1').body.toString(),'01');
 assert.equal(videoResponse(bytes,'bytes=-3').body.toString(),'789');
 assert.equal(videoResponse(bytes,'bytes=9-').body.toString(),'9');
 assert.equal(videoResponse(bytes,'bytes=99-').status,416);
 assert.equal(videoResponse(bytes,'bytes=0-1,5-6').status,416);
});
