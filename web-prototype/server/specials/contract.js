import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const ABI = 'opensmash-special-sets-v1';
export const SLOTS = ['neutral-ground', 'up-ground', 'down-ground', 'neutral-air', 'up-air', 'down-air'];
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const obj = properties => ({type:'object', properties, required:Object.keys(properties), additionalProperties:false});
const str = (maxLength=800) => ({type:'string',minLength:1,maxLength});
const num = (minimum,maximum) => ({type:'number',minimum,maximum});
const int = (minimum,maximum) => ({type:'integer',minimum,maximum});
const arr = (items,minItems,maxItems) => ({type:'array',items,minItems,maxItems});
const vec = (bound=1600) => arr(num(-bound,bound),3,3);
const slot = {type:'string',enum:SLOTS};
export const briefSchema = obj({identity:str(), palette:arr(int(0,255),3,3), moves:arr(obj({
  slot, name:str(60), signature:str(), anticipation:str(), action:str(), recovery:str(),
  groundAirDifference:str(), counterplay:str(), damage:int(1,32), startup:int(8,40), duration:int(35,150),
}),6,6)});
const trackSchema = obj({joint:str(32), keys:arr(obj({frame:int(0,150),degrees:vec(150)}),3,16)});
const hitSchema = obj({start:int(1,149),end:int(2,149),damage:int(1,32),angle:int(0,361),
  base:int(0,100),growth:int(0,150),radius:num(20,250),offset:vec(),to:vec()});
const partSchema = obj({hit:int(-1,7),start:int(0,149),end:int(1,150),from:vec(),to:vec(),
  size:arr(num(1,250),2,2),spin:num(-0.4,0.4),color:arr(int(0,255),3,3)});
export const implementationSchema = obj({moves:arr(obj({slot,tracks:arr(trackSchema,2,12),
  hitboxes:arr(hitSchema,1,8),parts:arr(partSchema,1,16),
  motion:obj({frame:int(-1,149),velocity:arr(num(-60,100),2,2)})}),6,6)});

export const richImplementationSchema=structuredClone(implementationSchema);
const richParts=richImplementationSchema.properties.moves.items.properties.parts;
richParts.maxItems=1024;
richParts.items.properties.from=vec(4096);richParts.items.properties.to=vec(4096);
richParts.items.properties.size=arr(num(1,500),2,2);
Object.assign(richParts.items.properties,{anchorFrame:int(-1,149),angle:num(-6.284,6.284),opacity:num(0,255),fade:num(0,150),sizeTo:arr(num(1,500),2,2),opacityTo:num(0,255)});
richParts.items.required.push('angle','opacity','fade','sizeTo','opacityTo');

// Shared strict subset used by the model schema and compiler. Reject unknown fields.
export function validate(schema, value, at='$') {
  const fail = why => { throw new Error(`${at}: ${why}`); };
  if(schema.enum && !schema.enum.includes(value)) fail('unknown enum');
  if(schema.type==='object') {
    if(!value || typeof value!=='object' || Array.isArray(value)) fail('expected object');
    for(const key of Object.keys(value)) if(!Object.hasOwn(schema.properties,key)) fail(`unknown field ${key}`);
    for(const key of Object.keys(schema.properties)) if(schema.required.includes(key)||Object.hasOwn(value,key)) validate(schema.properties[key],value[key],`${at}.${key}`);
  } else if(schema.type==='array') {
    if(!Array.isArray(value) || value.length<schema.minItems || value.length>schema.maxItems) fail('invalid array length');
    value.forEach((v,i)=>validate(schema.items,v,`${at}[${i}]`));
  } else if(schema.type==='string') {
    if(typeof value!=='string' || value.length<(schema.minLength||0) || value.length>(schema.maxLength||Infinity)) fail('invalid text');
  } else if(!Number.isFinite(value) || (schema.type==='integer'&&!Number.isInteger(value)) || value<schema.minimum || value>schema.maximum) fail('number outside bounds');
  return value;
}
function complete(moves) {
  if(new Set(moves.map(m=>m.slot)).size!==6 || !SLOTS.every(s=>moves.some(m=>m.slot===s))) throw new Error('all six unique special contexts are required');
}
export function validateBrief(brief) {
  validate(briefSchema,brief); complete(brief.moves);
  for(const m of brief.moves) if(m.duration<m.startup+14) throw new Error(`${m.slot}: insufficient recovery time`);
  return brief;
}
// Semantic roles use the same canonical Mario-to-target mappings as uploaded mesh retargeting.
const SEMANTIC = {torso:6,head:12,rightUpperArm:8,rightForearm:9,rightHand:10,leftUpperArm:14,leftForearm:15,leftHand:16,rightThigh:19,rightShin:20,leftThigh:24,leftShin:25};
export async function rigProfile(repoRoot, target='mario') {
  const names=['mario','fox','donkey','samus','luigi','link','yoshi','captain','kirby','pikachu','purin','ness'];
  if(!names.includes(target)) throw new Error('unsupported rig target');
  const source=target==='mario' ? {fkind:0,map:Object.fromEntries(Object.values(SEMANTIC).map(n=>[n,n]))} : JSON.parse(await readFile(path.join(repoRoot,'skels',`${target}.profile.json`),'utf8'));
  const joints={}, used=new Set();
  for(const [role,id] of Object.entries(SEMANTIC)) {
    const joint=source.map[String(id)];
    if(Number.isInteger(joint)&&joint>0&&joint<32&&!used.has(joint)) {joints[role]=joint;used.add(joint);}
  }
  if(!joints.torso || Object.keys(joints).length<2) throw new Error('rig has insufficient animation capabilities');
  return {target,fkind:source.fkind,joints,hash:hash(source),units:'engine-world-units',forward:'x',up:'y',depth:'z'};
}
export function compileSet({brief,implementation,profile,character,player=0,rich=false}) {
  validateBrief(brief);validate(rich?richImplementationSchema:implementationSchema,implementation);complete(implementation.moves);
  if(!Number.isInteger(player)||player<0||player>3) throw new Error('invalid player');
  const moves=SLOTS.map((slot,index)=>{
    const contract=brief.moves.find(m=>m.slot===slot), m=implementation.moves.find(m=>m.slot===slot);
    if(Buffer.byteLength(contract.name)>63) throw new Error(`${slot}: name exceeds runtime byte limit`);
    let previous=contract.startup;
    for(const h of m.hitboxes) {
      if(h.start<previous || h.end<=h.start || h.end>contract.duration-8) throw new Error(`${slot}: invalid hit window/recovery`);
      previous=h.end;
    }
    if(m.hitboxes[0].start!==contract.startup || m.hitboxes.reduce((n,h)=>n+h.damage,0)!==contract.damage) throw new Error(`${slot}: changed frozen timing or damage contract`);
    const tracks=m.tracks.map(t=>{
      if(!Object.hasOwn(profile.joints,t.joint)) throw new Error(`${slot}: unsupported joint ${t.joint}`);
      const first=t.keys[0],last=t.keys.at(-1);
      if(first.frame!==0 || last.frame!==contract.duration || [...first.degrees,...last.degrees].some(n=>n!==0)) throw new Error(`${slot}: pose endpoints must return to base`);
      t.keys.forEach((key,i)=>{if(i&&key.frame<=t.keys[i-1].frame)throw new Error(`${slot}: unsorted pose keys`);});
      return {...t,joint:profile.joints[t.joint]};
    });
    if(new Set(tracks.map(t=>t.joint)).size!==tracks.length) throw new Error(`${slot}: aliased pose joints`);
    for(const p of m.parts) {
      if(p.end<=p.start || p.end>contract.duration || p.hit>=m.hitboxes.length) throw new Error(`${slot}: invalid visual lifetime`);
      if(p.anchorFrame!==undefined && (p.anchorFrame>p.start || p.hit>=0&&p.anchorFrame>=0)) throw new Error(`${slot}: invalid particle birth anchor`);
      if(p.hit>=0) {
        const h=m.hitboxes[p.hit];
        if(p.start!==h.start||p.end!==h.end) throw new Error(`${slot}: danger cue lifetime differs from collision`);
      }
    }
    if(rich) for(let frame=0;frame<contract.duration;frame++) {
      if(m.parts.filter(p=>frame>=p.start&&frame<p.end).length>224) throw new Error(`${slot}: visible effects budget exceeded`);
    }
    m.hitboxes.forEach((h,i)=>{if(!m.parts.some(p=>p.hit===i)) throw new Error(`${slot}: missing danger cue ${i}`);});
    if(m.motion.frame>=contract.duration || m.motion.velocity[0]>60 || m.motion.velocity[1]<-80) throw new Error(`${slot}: invalid launch`);
    if(index%3===1 && (m.motion.frame<0||m.motion.frame>contract.startup||m.motion.velocity[1]<30)) throw new Error(`${slot}: up special requires launch by first hit`);
    return {version:rich?4:3,name:contract.name,fkind:profile.fkind,player,slot:index,duration:contract.duration,blend_in:Math.min(8,contract.startup),
      tracks,hitboxes:m.hitboxes.map(h=>({...h,joint:0})),parts:m.parts,motion:m.motion};
  });
  const result={format:ABI,character,rigHash:profile.hash,briefHash:hash(brief),sets:[{player,fkind:profile.fkind,moves}]};
  if(Buffer.byteLength(JSON.stringify(result))>1048576) throw new Error('package exceeds runtime budget');
  return result;
}
