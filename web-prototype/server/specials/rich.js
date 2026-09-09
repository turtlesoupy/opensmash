// Compact authoring, deterministic geometry. No character-specific runtime branches.
import {reducedSchema,expandReduced} from './reduced.js';
import {constructProp} from './visual-library.js';
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
 props:a(obj({id,pieces:a(piece,1,14)}),0,8),
 moves:a(obj({kind:base.kind,tracks:base.tracks,hits:base.hits,
 assemblies:a(assembly,0,4),cueColors:a(i(0,7),2,2),trails:a(trail,0,3),velocity:base.velocity,air:base.air}),3,3)});
// Named constructions remain replay-only for the historical hand-corrected demo.
// New authoring uses general geometry and rigid mounts, with no preset lookup.
piece.properties.mount=a(n(-400,400),0,2);
const propSchema=richSchema.properties.props.items;
propSchema.properties.construction={type:'string',enum:['pieces','bellows','music-note','straw']};
// Omission replays old scores with their historical curved cues.
richSchema.properties.moves.items.properties.presentation=obj({kind:{type:'string',enum:['body','prop','wave']},prop:{type:'string',maxLength:32}});
richSchema.properties.authoringVersion={type:'string',enum:['explicit-v2']};
export const richGenerationSchema=structuredClone(richSchema);
richGenerationSchema.required.push('authoringVersion');
delete richGenerationSchema.properties.props.items.properties.construction;
richGenerationSchema.properties.moves.items.required.push('presentation');
richGenerationSchema.properties.props.items.properties.pieces.items.required.push('mount');
export const RICH_IMPLEMENT=`Implement the frozen descriptions as three designs: neutral, up, and down, each with air overrides. Return JSON matching the supplied schema and set authoringVersion to "explicit-v2". Preserve the described action, names, timing, and total damage. The frozen descriptions already interpret any uploader move direction; do not redesign them from the original direction. Use body motion, props, waves, and particles only as the action requires. There are no named visual presets or quotas.

Coordinates and animation
All positions are relative to the fighter's root: x is forward, y is up, and z is depth. A fighter is approximately 350 world units tall. Joint rotations are local Euler-degree offsets from the resting pose; the engine interpolates them using quaternion slerp. Use only the supplied semantic joints. Write strictly increasing interior keyframes on the ground timeline, measured at 60 frames per second. The compiler adds resting-pose keys at frame zero and the move's end. Air tracks replace the named ground tracks; an empty list inherits all tracks.

Hard limits
The schema defines numerical and array bounds. Hit lengths are 1–40 frames and radii are 20–250 world units; these are limits, not recommended targets. Hit onsets must increase. Each move supports at most eight hits, and its frozen damage must provide at least one damage point per hit. The final hit must leave at least 12 frames of recovery in both contexts after compilation. A prop may expand to at most 60 rectangles, and a particle glyph to at most six. A move may contain at most 1,024 rendered segments, with no more than 224 rectangles visible simultaneously. Budget these after repetition and particle emission.

Timing transformations performed by the compiler
Hit delay values are offsets on a shared timeline, not waits after the previous hit. The first hit is anchored at the frozen startup; the compiler subtracts its delay from all hit delays. It ends any overlapping hit at the next onset. If the action cannot fit with 12 recovery frames in both contexts, it compresses the action and remaps body and assembly keys with the same time function. It then maps ground startup and duration to the frozen air startup and duration. Frame rounding can collapse short hits or nearby keys; invalid results are rejected, not regenerated. Prefer timing that already fits, so these transformations are small. Exact compiled timings and adjustments are recorded for review.

Damage and movement
Positive hit weights divide the frozen total damage, with at least one damage point per hit. Native knockback uses base 32 and growth 85 with your authored angle. Up specials launch at startup on ground and immediately in air; their vertical velocity has a compiler-enforced minimum of 70. For other moves, an empty velocity list means no launch; air inherits ground velocity unless overridden. air.hitShift translates collision and all supporting assemblies together in air; hit-bound props and emitted particles inherit the collision shift. It does not translate the skeletal body, so use air pose overrides to keep body attacks aligned. Air moves end on landing. Homing, healing, shields, reflectors, and autonomous projectiles are unsupported.

Geometry and materials
Define palette colors and reusable props using rectangular pieces. at is the local center, size contains half-width and half-height, color indexes the palette, and angle is in radians. A stripe's full width is twice size[0]. repeat and step copy a piece; use a zero step for a single copy. Leave actual gaps between details and avoid hiding them behind opaque foreground geometry. The compiler adds 120 depth units to assemblies and hit-bound weapons. Choose local depth offsets deliberately for layering.
For assembly animation, mount=[] makes a piece elastic: its center and size follow assembly scale. mount=[x,y] attaches a rigid piece at that point: the attachment follows scale, but piece size and offsets from the attachment stay fixed. Use the same mount for pieces whose internal spacing must remain rigid. Repeated copies retain that mount.

Assembly lifetimes and size
Assemblies are optional. Each has two to eight strictly increasing keys containing frame, at, and scale. They interpolate position and scale and exist only between their first and last keys. The compiler does not extend their lifetimes, enlarge them, or invent choreography. There is no special treatment for the first assembly. Choose dimensions and motion for the frozen action. Assemblies currently fade in across their first segment and out across their last segment; use additional keys when the object needs a sustained visible interval.

How the attack is shown
Choose presentation={kind,prop} for each move:
- body with prop="" uses skeletal motion and adds no hit effect. Keep the collision on the visible moving body throughout the hit, in both contexts. The compiler does not attach hitboxes to joints or certify this alignment; humans review it.
- prop names authored geometry that follows each hit's center for exactly that hit's lifetime. Its local offsets, dimensions, and orientation stay fixed during each hit. Supporting assemblies can show the same weapon during anticipation, gaps, and recovery, but may not overlap its active hit windows; overlapping copies of that prop are rejected. Match positions and scale at handoffs to avoid a pop.
- wave with prop="" uses the existing curved two-layer cue, with cueColors selecting its outer and inner colors.
Body and prop attacks do not need waves or particles. Supporting props can accompany any presentation. An empty props list and empty assemblies list support body-only attacks.

Optional particles
trails=[] emits none. Each trail names an authored glyph and a hit that emits it. The schema bounds count, lifetime, spread, and drift; choose values for the action. The runtime gives particles independent birth positions, inherited source velocity, gravity, connected rotation, and fading, and ends them by the move's duration. Authored glyph size is preserved. Particles must not seek the opponent or imply contact that did not occur.

Readability guidance, not mandatory styling
Judge scale and contrast at the match camera. Simplify or thicken details that would disappear, and keep the fighter readable. Dark outlines and bright accents are available choices, not required for every object. No minimum decorative prop size, particle size, preferred beat length, or fixed sweep distance is imposed beyond the schema's technical limits.

No model judges, ratings, repair calls, rerolls, or aesthetic revision loop. Human visual review remains separate.`;
const add=(a,b)=>a.map((x,k)=>x+b[k]);
const lerp=(a,b,u)=>a.map((x,k)=>x+(b[k]-x)*u);
export function expandRich({brief,score,onTransform=()=>{}}) {
 validate(richSchema,score);
 const explicit=score.authoringVersion==='explicit-v2';
 const props=new Map();
 for(const p of score.props){
  if(props.has(p.id))throw new Error('duplicate prop');
  const pieces=constructProp(p);
  if(p.pieces.some(p=>p.mount&&![0,2].includes(p.mount.length)))throw new Error('mount must be empty or a two-dimensional anchor');
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
  onTransform({kind:m.kind,firstDelayRemoved:first,actionScale:factor,
   overlapsClipped:raw.flatMap((h,k)=>raw[k+1]&&h.delay+h.length>raw[k+1].delay?[k]:[]),
   authoredHits:source.hits.map(h=>({delay:h.delay,length:h.length})),
   groundHits:m.hits.map(h=>({start:g.startup+h.delay,end:g.startup+h.delay+h.length})),
   groundDuration:g.duration,airDuration:a.duration,groundStartup:g.startup,airStartup:a.startup});
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
   if(!explicit&&assemblyIndex===0&&!pieces[0].articulated){
    const bounds=[0,1].map(axis=>{
     const lo=Math.min(...pieces.map(p=>p.at[axis]-p.size[axis]));
     const hi=Math.max(...pieces.map(p=>p.at[axis]+p.size[axis]));return hi-lo;
    });
    const fit=Math.max(1,400/Math.max(...bounds));
    pieces=pieces.map(p=>({...p,at:[p.at[0]*fit,p.at[1]*fit,p.at[2]],mount:p.mount?.map(x=>x*fit),size:p.size.map(x=>x*fit)}));
   }
   if(keys.some((k,j)=>k.frame>ground.duration||j&&k.frame<=keys[j-1].frame))throw new Error('invalid assembly keys');
   if(!explicit&&assemblyIndex===0){
    const setup=Math.max(0,ground.startup-8);
    if(keys[0].frame>setup)keys.unshift({...keys[0],frame:setup});
    const last=m.hits.at(-1),finish=ground.startup+last.delay-m.hits[0].delay+last.length;
    let end=Math.min(ground.duration,finish+10);
    while(time(end)<move.hitboxes.at(-1).end+8&&end<ground.duration)end++;
    if(keys.at(-1).frame<end)keys.push({...keys.at(-1),frame:end});
   }
   if(explicit&&m.presentation?.kind==='prop'&&assembly.prop===m.presentation.prop&&
      move.hitboxes.some(h=>time(keys[0].frame)<h.end&&time(keys.at(-1).frame)>h.start))
    throw new Error(`${move.slot}: supporting weapon assembly overlaps active hit`);
   if(pieces[0].articulated) {
    // Extension is synchronized to each emission; rigid cases never squash.
    const authored=structuredClone(keys),sample=f=>{
     const j=Math.max(0,authored.findIndex(k=>k.frame>=f)-1),a=authored[j],z=authored[Math.min(j+1,authored.length-1)];
     return lerp(a.at,z.at,Math.max(0,Math.min(1,(f-a.frame)/Math.max(1,z.frame-a.frame))));
    };
    const beats=new Map([[keys[0].frame,.36],[keys.at(-1).frame,.28]]);
    m.hits.forEach((h,j)=>{const onset=ground.startup+h.delay;beats.set(Math.max(keys[0].frame,onset-6),j===m.hits.length-1?1.4:1.08);beats.set(onset,.36);});
    keys.splice(0,keys.length,...[...beats].sort((a,b)=>a[0]-b[0]).map(([frame,x])=>({frame,at:sample(frame),scale:[x,1]})));
   }
   for(let k=0;k<keys.length-1;k++){
    const a=keys[k],z=keys[k+1],start=time(a.frame),end=time(z.frame);
    if(end<=start)throw new Error('collapsed assembly keys');
    // One segment interpolates the entire rigid assembly and its scale.
    for(let f=start;f<end;f=end){
     const stop=end,u=(f-start)/(end-start),w=(stop-start)/(end-start);
     const scale=lerp(a.scale,z.scale,u),scaleEnd=lerp(a.scale,z.scale,w);
     for(const p of pieces){
      const rigid=p.mount?.length===2;
      const xy=s=>rigid?p.at.slice(0,2).map((x,j)=>p.mount[j]*s[j]+x-p.mount[j]):[p.articulated?p.at[0]+p.extension*s[0]:p.at[0]*s[0],p.at[1]*s[1]];
      const pos=(t,s)=>add(add(add(t,[...xy(s),p.at[2]]),[0,0,120]),explicit&&context==='air'?m.air.hitShift:[0,0,0]);
      const size=s=>p.size.map((x,j)=>Math.max(1,x*(rigid||j===0&&p.articulated&&!p.stretch?1:s[j])));
      put({hit:-1,start:f,end:stop,from:pos(lerp(a.at,z.at,u),scale),to:pos(lerp(a.at,z.at,w),scaleEnd),size:size(scale),sizeTo:size(scaleEnd),angle:p.angle,color:p.rgb||color(p.color),opacity:k===0?100:225,opacityTo:k===keys.length-2?0:225});
     }
    }
   }
  }

  const presentation=m.presentation||{kind:'wave',prop:''};
  if(presentation.kind==='prop') {
   if(!presentation.prop)throw new Error('prop presentation requires a prop');
   const pieces=prop(presentation.prop);
   for(const [hit,h] of move.hitboxes.entries())for(const p of pieces)put({hit,start:h.start,end:h.end,from:add(p.at,[0,0,120]),to:add(p.at,[0,0,120]),size:p.size,angle:p.angle,color:p.rgb||color(p.color)});
  } else if(presentation.prop!=='')throw new Error('body/wave presentation must not name a prop');
  if(presentation.kind==='body')move.dangerSource='body';
  if(presentation.kind==='wave')for(const [hit,h] of move.hitboxes.entries()){
   const direction=Math.atan2(h.to[1]-h.offset[1],h.to[0]-h.offset[0]);
   for(let k=0;k<17;k++){
    const angle=direction-1.25+k*2.5/16,at=[Math.cos(angle)*h.radius*.93,Math.sin(angle)*h.radius*.93,90];
    for(let layer=0;layer<2;layer++)put({hit,start:h.start,end:h.end,from:add(at,[0,0,layer*2]),to:add(at,[0,0,layer*2]),size:[h.radius*.09,(layer?5:10)+(layer?3:5)*(1-(angle-direction)**2/2)],angle:angle+Math.PI/2,color:color(m.cueColors[layer]),opacity:(layer?230:210)*(1-(angle-direction)**2/2)});
   }
  }
  for(const trail of m.trails){
   const h=move.hitboxes[trail.hit];if(!h)throw new Error('unknown trail hit');
   let pieces=prop(trail.prop);if(pieces.length>6)throw new Error('trail prop exceeds six pieces');
   // Readability at the normal match camera: a glyph spans at least 100 world units.
   const extent=Math.max(...[0,1].map(j=>Math.max(...pieces.map(p=>p.at[j]+p.size[j]))-Math.min(...pieces.map(p=>p.at[j]-p.size[j]))));
   const fit=explicit?1:Math.max(1,100/extent);
   pieces=pieces.map(p=>({...p,at:p.at.map((x,j)=>j<2?x*fit:x),size:p.size.map(x=>x*fit)}));
   for(let k=0;k<trail.count;k++){
    const birth=h.start+Math.floor((h.end-h.start)*k/trail.count),life=Math.min(trail.life,b.duration-birth),seed=k*2.399963;
    const origin=lerp(h.offset,h.to,(birth-h.start)/Math.max(1,h.end-h.start-1));
    const vx=(h.to[0]-h.offset[0])/Math.max(1,h.end-h.start-1)*.55+trail.drift[0];
    const vy=(h.to[1]-h.offset[1])/Math.max(1,h.end-h.start-1)*.55+trail.drift[1];
    for(let age=0;age<life;age+=4){
     const stop=Math.min(age+4,life);
     const at=t=>add(origin,[vx*t,Math.sin(seed)*trail.spread+vy*t-.65*t*t,100]);
     // Rotate the whole connected glyph, and use endpoint ages matching native half-open interpolation.
     const rotate=(v,t)=>[v[0]*Math.cos(t*.05)-v[1]*Math.sin(t*.05),v[0]*Math.sin(t*.05)+v[1]*Math.cos(t*.05),v[2]];
     const alpha=t=>240*Math.min(1,(life-t)/Math.min(8,life));
     for(const p of pieces)put({hit:-1,anchorFrame:birth,start:birth+age,end:birth+stop,from:add(at(age),rotate(p.at,age)),to:add(at(stop-1),rotate(p.at,stop-1)),size:p.size,angle:p.angle+age*.05,spin:.05,opacity:alpha(age),opacityTo:alpha(stop-1),color:p.rgb||color(p.color)});
    }
   }
  }
  move.parts=parts;
 }
 return implementation;
}
export function compileRich(args){return compileSet({...args,implementation:expandRich(args),rich:true});}
