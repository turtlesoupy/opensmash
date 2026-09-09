import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SLOTS,rigProfile} from './specials/contract.js';
import {expandReduced,compileReduced} from './specials/reduced.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
function fixture(){
 const brief={identity:'accordion player',palette:[255,210,20],moves:SLOTS.map(slot=>({slot,name:slot,signature:'accordion',anticipation:'pull',action:'push',recovery:'relax',groundAirDifference:'tuck',counterplay:'startup',damage:slot.endsWith('air')?9:11,startup:slot.endsWith('air')?12:10,duration:slot.endsWith('air')?65:60}))};
 const reduced={colors:[[255,210,20]],props:[{id:'bellows',pieces:[{at:[0,0,0],size:[20,40],color:0}]}],moves:['neutral','up','down'].map(kind=>({kind,tracks:[{joint:'torso',keys:[{frame:8,degrees:[0,0,20]},{frame:20,degrees:[0,0,-20]}]},{joint:'head',keys:[{frame:10,degrees:[0,0,10]}]}],hits:[{delay:0,length:4,weight:1,angle:45,radius:50,from:[150,150,0],to:[220,150,0]},{delay:8,length:4,weight:2,angle:45,radius:50,from:[150,150,0],to:[220,150,0]}],visuals:[{prop:'bellows',hit:0,window:[],from:[0,0,0],to:[0,0,0]},{prop:'bellows',hit:1,window:[],from:[0,0,0],to:[0,0,0]}],emitters:[{color:0,count:3,window:[15,30],origin:[150,150,0],spread:40,travel:[0,50,0],size:[4,4]}],velocity:[],air:{tracks:[{joint:'head',keys:[{frame:10,degrees:[0,0,-15]}]}],hitShift:[0,-20,0],velocity:[]}}))};
 return {brief,reduced,character:{id:'test'}};
}
test('six contexts preserve budgets, exact cues, defaults and air overrides without mutation',async()=>{
 const args={...fixture(),profile:await rigProfile(root)};const before=JSON.stringify(args);
 const {sets:[{moves}]}=compileReduced(args);assert.equal(moves.length,6);
 for(const [k,m] of moves.entries()){
  assert.equal(m.hitboxes.reduce((s,h)=>s+h.damage,0),k<3?11:9);
  assert.equal(m.hitboxes[0].start,k<3?10:12);assert.equal(m.parts.length,5);
  for(let j=0;j<2;j++){assert.equal(m.parts[j].start,m.hitboxes[j].start);assert.equal(m.parts[j].end,m.hitboxes[j].end);}
  assert.deepEqual(m.tracks[0].keys[0],{frame:0,degrees:[0,0,0]});
  assert.deepEqual(m.tracks[0].keys.at(-1),{frame:k<3?60:65,degrees:[0,0,0]});
  assert.equal(m.tracks[1].keys[1].degrees[2],k<3?10:-15);
  assert.equal(m.hitboxes[0].offset[1],k<3?150:130);
  assert.deepEqual(m.motion,k%3===1?{frame:k<3?10:0,velocity:[0,70]}:{frame:-1,velocity:[0,0]});
 }
 assert.equal(JSON.stringify(args),before);assert.deepEqual(compileReduced(args),compileReduced(args));
});
test('damage remainder uses deterministic integer allocation',()=>{
 const expanded=expandReduced(fixture());
 assert.deepEqual(expanded.moves[0].hitboxes.map(h=>h.damage),[4,7]);
 assert.deepEqual(expanded.moves[3].hitboxes.map(h=>h.damage),[3,6]);
});
test('twelve rig profiles accept reduced poses using their supported semantic roles',async()=>{
 for(const target of ['mario','fox','donkey','samus','luigi','link','yoshi','captain','kirby','pikachu','purin','ness']) {
 const args={...fixture(),profile:await rigProfile(root,target)};const roles=Object.keys(args.profile.joints);
 for(const m of args.reduced.moves){m.tracks[0].joint=roles[0];m.tracks[1].joint=roles[1];m.air.tracks[0].joint=roles[1];}
 assert.equal(compileReduced(args).sets[0].moves.length,6);
 }
});
for(const [name,change] of [
 ['oversized effects',a=>a.reduced.moves[0].emitters.push(...Array.from({length:3},()=>({...a.reduced.moves[0].emitters[0],count:8})))],
 ['unknown prop',a=>a.reduced.moves[0].visuals[0].prop='missing'],
 ['unknown color',a=>a.reduced.props[0].pieces[0].color=7],
 ['duplicate moves',a=>a.reduced.moves[1].kind='neutral'],
 ['duplicate tracks',a=>a.reduced.moves[0].tracks[1].joint='torso'],
 ['invalid interior endpoint',a=>a.reduced.moves[0].tracks[0].keys[0].frame=0],
 ['collapsed air keys',a=>{a.brief.moves[3].startup=8;a.reduced.moves[0].tracks[0].keys=[{frame:2,degrees:[1,0,0]},{frame:3,degrees:[2,0,0]}];}],
 ['overlapping hits',a=>a.reduced.moves[0].hits[1].delay=1],
 ['missing danger cue',a=>a.reduced.moves[0].visuals.pop()],
 ['invalid recovery',a=>a.reduced.moves[1].air.velocity=[0,1]],
 ['bad velocity length',a=>a.reduced.moves[0].velocity=[1]],
 ['invalid decorative window',a=>{a.reduced.moves[0].visuals[0].hit=-1;}],
])test(`rejects ${name}`,async()=>{const args={...fixture(),profile:await rigProfile(root)};change(args);assert.throws(()=>compileReduced(args));});
