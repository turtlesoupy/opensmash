// Compact authoring, deterministic geometry. No character-specific runtime branches.
import {reducedSchema,expandReduced} from './reduced.js';
import {validate,compileSet} from './contract.js';
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const n=(minimum,maximum)=>({type:'number',minimum,maximum});
const i=(minimum,maximum)=>({type:'integer',minimum,maximum});
const a=(items,minItems,maxItems)=>({type:'array',items,minItems,maxItems});
const v=(bound=1200)=>a(n(-bound,bound),3,3);
const id={type:'string',minLength:1,maxLength:32};
const vec2=a(n(.2,2),2,2);
const piece=obj({at:v(400),size:a(n(1,160),2,2),color:i(0,7),angle:n(-3.14,3.14),repeat:i(1,16),step:v(100)});
const assembly=obj({prop:id,keys:a(obj({frame:i(0,150),at:v(),scale:vec2}),2,8)});
const trail=obj({prop:id,hit:i(0,7),count:i(3,10),life:i(12,24),spread:n(20,160),drift:a(n(-10,10),2,2)});
const base=reducedSchema.properties.moves.items.properties;
export const richSchema=obj({colors:reducedSchema.properties.colors,
 props:a(obj({id,pieces:a(piece,1,14)}),2,8),
 moves:a(obj({kind:base.kind,tracks:base.tracks,hits:base.hits,
 assemblies:a(assembly,1,4),cueColors:a(i(0,7),2,2),trails:a(trail,1,3),velocity:base.velocity,air:base.air}),3,3)});
export const RICH_IMPLEMENT=`Implement all six frozen special descriptions using this compact visual score. Return three designs neutral/up/down; ground/air share authored geometry and timing with deliberate air pose overrides. No character-specific code.
Coordinates x forward, y up, z depth. Fighter height about 350. All frames use the GROUND timeline. Air startup and remaining duration are remapped automatically. Tracks: supported semantic joints only; interior frames strictly increasing in (0,duration); compiler adds zero endpoints. Animate torso, both arms and legs where supported: anticipate, strike, follow through, recover. Air.tracks replaces listed tracks; [] inherits. Air.hitShift offsets collision, not decorative prop placement.
Hits: delay and length express the relative action rhythm in ground frames. First delay preferably 0, subsequent onsets increasing. Compiler anchors the first beat at startup, clips a beat at the next onset, and fits the action to leave 12 recovery frames in BOTH contexts. It warps body and prop keys along with the action. Prefer length4..24 and naturally separated beats. You do not need to duplicate collision/cue timing arithmetic. Weight divides frozen damage deterministically. Radius 80..250 for readable strong attacks. Native knockback is generated. Use 2-3 rhythmic hits for a buildup/finale if described; final hit can sweep from near x200 to x1000. Never target-seeking. Up recovery has a compiler-enforced vertical speed floor of 70; launch at startup on ground, immediately in air; other moves [] remain planted. Air.velocity=[] inherits.
Define reusable detailed props and small particle glyphs in colors/props once. Each prop piece is a rectangle: at local center, size HALF extents, color palette index, angle radians. repeat and step cheaply make rows of keys, folds, buttons, trim or spokes. repeat=1,step=[0,0,0] for single pieces. Use 5-10 layered pieces (including repeated details) for the main prop; 2-4 pieces for a distinctive small trail glyph. E.g. bellows with repeated folds + side cases + ivory keys, or a recognizable object with borders/interior detail. No single-block substitutes. Local z 0..30 controls layering; compiler places props in front of fighter at z120 automatically. Palette needs dark outline, main color and bright accents.
Assemblies instance props with 2-8 keys {frame,at,scale:[x,y]}. Keys are strictly increasing, last<=duration. Prop translates and its piece centers/size stretch between keys; use this for squeezes, windup, sweep, follow-through. The first assembly is the signature prop. Its lifetime is padded by the compiler to cover startup-8 through lastHitEnd+8; author its performance keys within that window. The signature assembly is normalized to at least 400 units along its largest dimension before your animation scale, so internal details remain readable. Keep its action scale about1; small secondary glyphs are not normalized. Model writes choreography; repeated geometry is compiled. Keyframe every squeeze; don't flash a prop for a few frames. At least one setup assembly must span anticipation/action/recovery.
Each hit automatically gets a layered curved danger cue along its actual collision radius/trajectory, exactly during its collision window; cueColors=[darkOutline,brightCore] palette indices. Do NOT spend tokens on individual wave segments. Trails instance a small prop glyph: hit index emits evenly spaced births along that actual trajectory, count3..10, life12..24, spread20..160; drift=[vx,vy] adds units/frame. Compiler adds source velocity, falling acceleration, rotation and opacity fade; particles never seek a target. Every special needs a meaningful trail. Keep each trail prop <=6 expanded pieces; main assembly <=60 pieces. Budget <=224 simultaneous rectangles, <=1024 over move. Preserve the written spectacle, not just damage. No judges, repair loops or aesthetic scoring.`;
const add=(a,b)=>a.map((x,k)=>x+b[k]);
const lerp=(a,b,u)=>a.map((x,k)=>x+(b[k]-x)*u);
export function expandRich({brief,score}) {
 validate(richSchema,score);
 const props=new Map();
 for(const p of score.props){
  if(props.has(p.id))throw new Error('duplicate prop');
  const pieces=p.pieces.flatMap(p=>Array.from({length:p.repeat},(_,k)=>({...p,at:add(p.at,p.step.map(x=>x*k))})));
  if(pieces.length>60)throw new Error('prop exceeds 60 pieces');
  props.set(p.id,pieces);
 }
 const color=k=>{if(!score.colors[k])throw new Error('unknown color');return [...score.colors[k]];};
 const prop=id=>{if(!props.has(id))throw new Error('unknown prop');return props.get(id);};
 // Treat beat offsets/lengths as rhythm, not duplicated authoritative timing.
 // Fit action to both frozen contexts and warp poses/props with the same map.
 const normalized=score.moves.map(source=>{
  const m=structuredClone(source),g=brief.moves.find(b=>b.slot===`${m.kind}-ground`),a=brief.moves.find(b=>b.slot===`${m.kind}-air`);
  const first=m.hits[0].delay;
  const raw=m.hits.map(h=>({...h,delay:h.delay-first}));
  if(raw.some((h,k)=>h.delay<0||k&&h.delay<=raw[k-1].delay))throw new Error('beat onsets must increase');
  const span=raw.at(-1).delay+raw.at(-1).length;
  const rest=g.duration-g.startup,airRest=a.duration-a.startup;
  const available=Math.min(rest-12,rest*(airRest-12)/airRest);
  const factor=Math.min(1,available/span),oldEnd=g.startup+span,newEnd=g.startup+span*factor;
  const warp=f=>Math.round(f<=g.startup?f:f<=oldEnd?g.startup+(f-g.startup)*factor:newEnd+(f-oldEnd)*(g.duration-newEnd)/(g.duration-oldEnd));
  m.hits=raw.map((h,k)=>{
   const end=Math.min(h.delay+h.length,raw[k+1]?.delay??Infinity);
   const start=warp(g.startup+h.delay),stop=warp(g.startup+end);
   if(stop<=start)throw new Error('beat too short for frozen duration');
   return {...h,delay:start-g.startup,length:stop-start};
  });
  for(const t of [...m.tracks,...m.air.tracks])for(const k of t.keys)k.frame=warp(k.frame);
  for(const p of m.assemblies)for(const k of p.keys)k.frame=warp(k.frame);
  return m;
 });
 const dummy={colors:[[255,255,255]],props:[{id:'cue',pieces:[{at:[0,0,0],size:[1,1],color:0}]}],moves:normalized.map(m=>({kind:m.kind,tracks:m.tracks,hits:m.hits.map(h=>({...h,delay:h.delay-m.hits[0].delay})),visuals:m.hits.map((_,hit)=>({prop:'cue',hit,window:[],from:[0,0,0],to:[0,0,0]})),emitters:[],velocity:m.kind==='up'?[m.velocity[0]||0,Math.max(70,m.velocity[1]||0)]:m.velocity,air:{...m.air,velocity:m.kind==='up'?[m.air.velocity[0]??m.velocity[0]??0,Math.max(70,m.air.velocity[1]||m.velocity[1]||0)]:m.air.velocity}}))};
 const implementation=expandReduced({brief,reduced:dummy});
 for(const move of implementation.moves){
  const [kind,context]=move.slot.split('-'),m=normalized.find(m=>m.kind===kind);
  const ground=brief.moves.find(m=>m.slot===`${kind}-ground`),b=brief.moves.find(m=>m.slot===move.slot);
  const time=f=>context==='air'?Math.round(f<=ground.startup?f*b.startup/ground.startup:b.startup+(f-ground.startup)*(b.duration-b.startup)/(ground.duration-ground.startup)):f;
  const parts=[];
  const put=p=>parts.push({spin:0,angle:0,opacity:225,fade:0,...p,sizeTo:p.sizeTo||p.size,opacityTo:p.opacityTo??p.opacity??225});
  
  for(const [assemblyIndex,assembly] of m.assemblies.entries()){
   let pieces=prop(assembly.prop);const keys=structuredClone(assembly.keys);
   if(assemblyIndex===0){
    const bounds=[0,1].map(axis=>{
     const lo=Math.min(...pieces.map(p=>p.at[axis]-p.size[axis]));
     const hi=Math.max(...pieces.map(p=>p.at[axis]+p.size[axis]));return hi-lo;
    });
    const fit=Math.max(1,400/Math.max(...bounds));
    pieces=pieces.map(p=>({...p,at:[p.at[0]*fit,p.at[1]*fit,p.at[2]],size:p.size.map(x=>x*fit)}));
   }
   if(keys.some((k,j)=>k.frame>ground.duration||j&&k.frame<=keys[j-1].frame))throw new Error('invalid assembly keys');
   if(assemblyIndex===0){
    const setup=Math.max(0,ground.startup-8);
    if(keys[0].frame>setup)keys.unshift({...keys[0],frame:setup});
    const last=m.hits.at(-1),finish=ground.startup+last.delay-m.hits[0].delay+last.length;
    let end=Math.min(ground.duration,finish+10);
    while(time(end)<move.hitboxes.at(-1).end+8&&end<ground.duration)end++;
    if(keys.at(-1).frame<end)keys.push({...keys.at(-1),frame:end});
   }
   for(let k=0;k<keys.length-1;k++){
    const a=keys[k],z=keys[k+1],start=time(a.frame),end=time(z.frame);
    if(end<=start)throw new Error('collapsed assembly keys');
    // One segment interpolates the entire rigid assembly and its scale.
    for(let f=start;f<end;f=end){
     const stop=end,u=(f-start)/(end-start),w=(stop-start)/(end-start);
     const scale=lerp(a.scale,z.scale,u),scaleEnd=lerp(a.scale,z.scale,w);
     for(const p of pieces){
      const pos=(t,s)=>add(add(t,[p.at[0]*s[0],p.at[1]*s[1],p.at[2]]),[0,0,120]);
      put({hit:-1,start:f,end:stop,from:pos(lerp(a.at,z.at,u),scale),to:pos(lerp(a.at,z.at,w),scaleEnd),size:p.size.map((x,j)=>Math.max(1,x*scale[j])),sizeTo:p.size.map((x,j)=>Math.max(1,x*scaleEnd[j])),angle:p.angle,color:color(p.color),opacity:k===0?100:225,opacityTo:k===keys.length-2?0:225});
     }
    }
   }
  }

  for(const [hit,h] of move.hitboxes.entries()){
   const direction=Math.atan2(h.to[1]-h.offset[1],h.to[0]-h.offset[0]);
   for(let k=0;k<17;k++){
    const angle=direction-1.25+k*2.5/16,at=[Math.cos(angle)*h.radius*.93,Math.sin(angle)*h.radius*.93,90];
    for(let layer=0;layer<2;layer++)put({hit,start:h.start,end:h.end,from:add(at,[0,0,layer*2]),to:add(at,[0,0,layer*2]),size:[h.radius*.09,layer?5:10],angle:angle+Math.PI/2,color:color(m.cueColors[layer])});
   }
  }
  for(const trail of m.trails){
   const h=move.hitboxes[trail.hit];if(!h)throw new Error('unknown trail hit');
   const pieces=prop(trail.prop);if(pieces.length>6)throw new Error('trail prop exceeds six pieces');
   for(let k=0;k<trail.count;k++){
    const birth=h.start+Math.floor((h.end-h.start)*k/trail.count),life=Math.min(trail.life,b.duration-birth),seed=k*2.399963;
    const origin=lerp(h.offset,h.to,(birth-h.start)/Math.max(1,h.end-h.start-1));
    const vx=(h.to[0]-h.offset[0])/Math.max(1,h.end-h.start-1)*.55+trail.drift[0];
    for(let age=0;age<life;age+=4){
     const stop=Math.min(age+4,life);
     const at=t=>add(origin,[vx*t,Math.sin(seed)*trail.spread+trail.drift[1]*t-.65*t*t,100]);
     for(const p of pieces)put({hit:-1,start:birth+age,end:birth+stop,from:add(at(age),p.at),to:add(at(stop),p.at),size:p.size,angle:p.angle+age*.05,spin:.05,opacity:205*(1-age/life),color:color(p.color)});
    }
   }
  }
  move.parts=parts;
 }
 return implementation;
}
export function compileRich(args){return compileSet({...args,implementation:expandRich(args),rich:true});}
