// Experimental authoring format. Expansion targets the unchanged full contract.
import {validate, validateBrief, compileSet, SLOTS} from './contract.js';
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const n=(minimum,maximum)=>({type:'number',minimum,maximum});
const i=(minimum,maximum)=>({type:'integer',minimum,maximum});
const a=(items,minItems,maxItems)=>({type:'array',items,minItems,maxItems});
const v=(bound=1600)=>a(n(-bound,bound),3,3);
const id={type:'string',minLength:1,maxLength:32};
const track=obj({joint:id,keys:a(obj({frame:i(1,149),degrees:v(150)}),1,14)});
const hit=obj({delay:i(0,100),length:i(1,40),weight:i(1,32),angle:i(0,361),radius:n(20,250),from:v(),to:v()});
const visual=obj({prop:id,hit:i(-1,7),window:a(i(0,150),0,2),from:v(),to:v()});
const emitter=obj({color:i(0,7),count:i(1,8),window:a(i(0,150),2,2),origin:v(),spread:n(1,200),travel:v(),size:a(n(1,250),2,2)});
export const reducedSchema=obj({
 colors:a(a(i(0,255),3,3),1,8),
 props:a(obj({id,pieces:a(obj({at:v(),size:a(n(1,250),2,2),color:i(0,7)}),1,12)}),1,8),
 moves:a(obj({kind:{type:'string',enum:['neutral','up','down']},tracks:a(track,2,12),hits:a(hit,1,8),visuals:a(visual,1,16),emitters:a(emitter,0,4),velocity:a(n(-60,100),0,2),air:obj({tracks:a(track,0,12),hitShift:v(),velocity:a(n(-60,100),0,2)})}),3,3)
});
export const REDUCED_IMPLEMENT=`Implement the frozen description in this reduced authoring format, with explicit custom joint keyframes. Produce three moves (neutral/up/down); the compiler expands ground and air. Do not read or imitate another implementation.
Coordinates: x forward, y up, z depth; fighter height ~350. Pose degrees are local deltas, quaternion-interpolated. Write only interior keys: frame 0 and duration zero-pose endpoints are inserted. All authored frames use the ground description timeline. Air timing automatically remaps ground startup to air startup and ground duration to air duration, piecewise linearly. Air.tracks replaces only listed joint tracks, in that same ground time domain; empty inherits. Use these overrides for deliberate tucked-leg/air poses.
Hits start at ground startup+delay; first delay=0. Nonoverlapping windows, ending >=8 frames before BOTH descriptions' duration after remapping. Damage is divided by positive integer weight with a minimum of 1 per hit; compiler preserves each description's total. Native knockback defaults base32/growth85. Hit from/to are root-relative. air.hitShift offsets both endpoints (use [0,0,0] if unchanged).
Define reusable colors and rectangular prop pieces once. Each visual instances a prop: hit>=0 inherits exact hit timing and trajectory; window=[]; from/to are offsets from that trajectory. Decorative hit=-1 uses window=[start,end] and root-relative from/to. Each piece adds its at offset. All visuals have spin0. Props may be instanced for windup, impact and recovery. Every hit needs a bound visible prop.
Emitters are decorative fans: count copies spread symmetrically on x, moving from origin toward origin+travel+[fanOffset,abs(fanOffset)/2,0], alternating small spins, fading out. Their window is [start,end]. Use for musical/paper/dust fragments, never target-seeking. Total expanded prop pieces plus emitter count MUST be <=16 per context. Prefer a few meaningful pieces, not many rectangles.
velocity=[] means native default: up=[0,70]; ground up launches at startup, air up launches immediately to avoid landing during windup. Other specials have no launch. [forward,up] overrides velocity using the same launch timing; air.velocity=[] inherits. Up velocity y>=30. No code, judges, scores, homing, projectiles, healing, or aesthetic revision loop. Preserve identity, timing, damage and all six descriptions. Each move must visibly anticipate, act and recover. Ground and air share design, not necessarily stance.`;
const plus=(a,b)=>a.map((x,k)=>x+b[k]);
const unique=(rows,key,label)=>{if(new Set(rows.map(x=>x[key])).size!==rows.length)throw new Error(`duplicate ${label}`);};
export function expandReduced({brief,reduced}) {
 validateBrief(brief);validate(reducedSchema,reduced);
 unique(reduced.props,'id','prop');unique(reduced.moves,'kind','move');
 if(!['neutral','up','down'].every(k=>reduced.moves.some(m=>m.kind===k)))throw new Error('three unique specials required');
 const color=index=>{if(!reduced.colors[index])throw new Error('unknown color');return [...reduced.colors[index]];};
 const moves=SLOTS.map(slot=>{
  const [kind,context]=slot.split('-'),air=context==='air',m=reduced.moves.find(m=>m.kind===kind);
  const ground=brief.moves.find(m=>m.slot===`${kind}-ground`),contract=brief.moves.find(m=>m.slot===slot);
  const time=f=>air?Math.round(f<=ground.startup?f*contract.startup/ground.startup:contract.startup+(f-ground.startup)*(contract.duration-contract.startup)/(ground.duration-ground.startup)):f;
  unique(m.tracks,'joint','track');unique(m.air.tracks,'joint','air track');
  const merged=new Map(m.tracks.map(t=>[t.joint,t]));
  if(air)for(const t of m.air.tracks)merged.set(t.joint,t);
  const tracks=[...merged.values()].map(t=>{
   if(t.keys.some((k,j)=>k.frame>=ground.duration || j&&k.frame<=t.keys[j-1].frame))throw new Error(`${slot}: invalid interior keys`);
   const keys=t.keys.map(k=>({...k,frame:time(k.frame)}));
   if(keys.some((k,j)=>k.frame<=0||k.frame>=contract.duration||j&&k.frame<=keys[j-1].frame))throw new Error(`${slot}: remapped key collision`);
   return {joint:t.joint,keys:[{frame:0,degrees:[0,0,0]},...keys,{frame:contract.duration,degrees:[0,0,0]}]};
  });
  const budget=contract.damage-m.hits.length,total=m.hits.reduce((s,h)=>s+h.weight,0);
  if(budget<0)throw new Error('too many hits for damage budget');
  const shares=m.hits.map(h=>budget*h.weight/total),damages=shares.map(s=>1+Math.floor(s));
  let remainder=contract.damage-damages.reduce((a,b)=>a+b,0);
  for(const x of shares.map((s,k)=>({k,f:s-Math.floor(s)})).sort((a,b)=>b.f-a.f||a.k-b.k))if(remainder-->0)damages[x.k]++;
  const shift=air?m.air.hitShift:[0,0,0];
  const hitboxes=m.hits.map((h,k)=>({start:time(ground.startup+h.delay),end:time(ground.startup+h.delay+h.length),damage:damages[k],angle:h.angle,base:32,growth:85,radius:h.radius,offset:plus(h.from,shift),to:plus(h.to,shift)}));
  const parts=m.visuals.flatMap(q=>{
   const prop=reduced.props.find(p=>p.id===q.prop);if(!prop)throw new Error('unknown prop');
   const h=hitboxes[q.hit];if(q.hit>=0&&!h)throw new Error('unknown visual hit');
   if(q.hit>=0?q.window.length!==0:q.window.length!==2)throw new Error('invalid visual window');
   return prop.pieces.map(p=>({hit:q.hit,start:h?h.start:time(q.window[0]),end:h?h.end:time(q.window[1]),from:plus(q.from,p.at),to:plus(q.to,p.at),size:[...p.size],spin:0,color:color(p.color)}));
  });
  for(const e of m.emitters)for(let k=0;k<e.count;k++){
   const fan=e.count===1?0:e.spread*(2*k/(e.count-1)-1);
   parts.push({hit:-1,start:time(e.window[0]),end:time(e.window[1]),from:[...e.origin],to:plus(plus(e.origin,e.travel),[fan,Math.abs(fan)/2,0]),size:[...e.size],spin:k%2?0.06:-0.06,color:color(e.color)});
  }
  const velocity=air&&m.air.velocity.length?m.air.velocity:m.velocity.length?m.velocity:kind==='up'?[0,70]:[0,0];
  if(velocity.length!==2)throw new Error('velocity must be empty or two values');
  const launch=kind==='up'||velocity.some(x=>x!==0);
  return {slot,tracks,hitboxes,parts,motion:{frame:launch?(kind==='up'&&air?0:contract.startup):-1,velocity:[...velocity]}};
 });
 return {moves};
}
export function compileReduced(args) {
 return compileSet({...args,implementation:expandReduced(args)});
}
