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
 props:a(obj({id,pieces:a(piece,1,14)}),2,8),
 moves:a(obj({kind:base.kind,tracks:base.tracks,hits:base.hits,
 assemblies:a(assembly,1,4),cueColors:a(i(0,7),2,2),trails:a(trail,1,3),velocity:base.velocity,air:base.air}),3,3)});
// Named constructions remain replay-only for the historical hand-corrected demo.
// New authoring uses general geometry and rigid mounts, with no preset lookup.
piece.properties.mount=a(n(-400,400),0,2);
const propSchema=richSchema.properties.props.items;
propSchema.properties.construction={type:'string',enum:['pieces','bellows','music-note','straw']};
export const richGenerationSchema=structuredClone(richSchema);
delete richGenerationSchema.properties.props.items.properties.construction;
richGenerationSchema.properties.props.items.properties.pieces.items.required.push('mount');
export const RICH_IMPLEMENT=`Implement the frozen six special descriptions as three compact designs: neutral/up/down, with intentional air overrides. Author every prop, glyph, palette and pose from the description. There are no named visual presets. Return only the supplied schema.
COORDINATES: x forward, y up, z depth; fighter height about350 world units. Frames are 60Hz GROUND frames; the compiler remaps to air timing. Supported semantic joints only. Tracks have increasing interior keys in (0,ground duration); compiler adds zero endpoints. Air.tracks replaces named tracks; [] inherits. Air.hitShift shifts collision, not props.
HITS: delay/length express beat rhythm; onsets must increase. Compiler anchors first beat at startup, clips overlaps at the next onset, fits action to leave12 recovery frames in BOTH contexts, and warps poses/assemblies identically. Prefer separated beats of length4..24. Weight divides the frozen damage. Radius80..250. Native knockback is generated. A grounded sweep can travel from x200 to1000. Up velocity has vertical floor70, launching at startup on ground and immediately in air. Other velocity=[] stays planted; air.velocity=[] inherits. No homing, healing, shields, reflectors or autonomous projectiles.
GEOMETRY: palette colors and reusable props with rectangular pieces. at=local center, size=HALF extents, color=palette index, angle=radians. repeat/step replicate a detail; repeat1 uses step[0,0,0]. Local depth0..30 orders layers; the compiler adds foreground depth120. Main props <=60 expanded rectangles; trail glyphs <=6. All detail must come from your pieces.
MATERIAL MOTION: mount=[] means elastic: center and size follow assembly.scale. mount=[x,y] means rigid around that attachment: the mount follows assembly.scale, while the offset from mount and the piece size remain fixed. Repeat copies keep that same mount so rigid decorations retain spacing. Give all pieces of one rigid subassembly the same mount. This supports rigid details attached to deforming material without distorting their shape. Author mount coordinates in the same space as at.
ASSEMBLIES: 2..8 strictly increasing keys {frame,at,scale:[x,y]}, last<=ground duration. Translation and elastic scale interpolate; there is no automatic performance choreography. Time each change to the intended action beat. First assembly is the signature prop; compiler pads its lifetime to cover startup-8 through lastHitEnd+8 and normalizes its largest dimension to at least400 units. Keep action scale around1. Other assemblies retain authored size. Express setup, action and recovery, not a single flash.
EFFECTS: each hit receives a layered curved cue aligned with its real collision trajectory/window, using cueColors=[outline,brightCore]. Trails emit an authored glyph along the chosen hit: count3..10, life12..24, spread20..160, drift=[vx,vy]. Engine handles independent birth positions, both axes of source velocity, falling motion, connected rotation and smooth fade. Glyph extent is at least100 units; choose thicker strokes and larger shapes where necessary. Keep particles within the visible region after emission. Every special requires a meaningful authored trail.
BUDGETS: <=224 simultaneous rectangles and <=1024 segments over a move. Repeated details and trail pieces consume this budget after expansion; use a small number of meaningful assemblies and glyph strokes. Preserve the frozen description's spectacle within these limits. No judges, ratings, revision calls or aesthetic scoring.`;
const add=(a,b)=>a.map((x,k)=>x+b[k]);
const lerp=(a,b,u)=>a.map((x,k)=>x+(b[k]-x)*u);
export function expandRich({brief,score}) {
 validate(richSchema,score);
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
   if(assemblyIndex===0&&!pieces[0].articulated){
    const bounds=[0,1].map(axis=>{
     const lo=Math.min(...pieces.map(p=>p.at[axis]-p.size[axis]));
     const hi=Math.max(...pieces.map(p=>p.at[axis]+p.size[axis]));return hi-lo;
    });
    const fit=Math.max(1,400/Math.max(...bounds));
    pieces=pieces.map(p=>({...p,at:[p.at[0]*fit,p.at[1]*fit,p.at[2]],mount:p.mount?.map(x=>x*fit),size:p.size.map(x=>x*fit)}));
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
      const pos=(t,s)=>add(add(t,[...xy(s),p.at[2]]),[0,0,120]);
      const size=s=>p.size.map((x,j)=>Math.max(1,x*(rigid||j===0&&p.articulated&&!p.stretch?1:s[j])));
      put({hit:-1,start:f,end:stop,from:pos(lerp(a.at,z.at,u),scale),to:pos(lerp(a.at,z.at,w),scaleEnd),size:size(scale),sizeTo:size(scaleEnd),angle:p.angle,color:p.rgb||color(p.color),opacity:k===0?100:225,opacityTo:k===keys.length-2?0:225});
     }
    }
   }
  }

  for(const [hit,h] of move.hitboxes.entries()){
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
   const fit=Math.max(1,100/extent);
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
