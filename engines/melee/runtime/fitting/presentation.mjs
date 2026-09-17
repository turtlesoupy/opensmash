/** Existing stature and attachment rules, evaluated from reusable target data. */
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mul=(a,b)=>Array.from({length:16},(_,i)=>{const r=i>>2,c=i%4;let v=0;for(let k=0;k<4;k++)v+=a[r*4+k]*b[k*4+c];return v;});
const vector=(m,p,w=0)=>[0,1,2].map(r=>m[r*4]*p[0]+m[r*4+1]*p[1]+m[r*4+2]*p[2]+m[r*4+3]*w);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const normalized=v=>{const l=Math.hypot(...v);if(l<1e-12)throw Error('Degenerate attachment normal');return v.map(x=>x/l);};
function rotation(axis,angle){const [x,y,z]=normalized(axis),c=Math.cos(angle),s=Math.sin(angle),t=1-c;return [c+x*x*t,x*y*t-z*s,x*z*t+y*s,0,y*x*t+z*s,c+y*y*t,y*z*t-x*s,0,z*x*t-y*s,z*y*t+x*s,c+z*z*t,0,0,0,0,1];}
export function preparePresentation(target,fitted){
  const slots=target.mode==='round'?5:4;
  let low=Infinity,high=-Infinity;for(let i=1;i<fitted.positions.length;i+=3){low=Math.min(low,fitted.positions[i]);high=Math.max(high,fitted.positions[i]);}
  const scale=target.mode==='round'?1:(target.originalBounds[1]-target.originalBounds[0])/(high-low);
  const offset=target.mode==='round'?0:target.originalBounds[0]-scale*low;
  if(!Number.isFinite(scale+offset)||scale<=.2||scale>=3)throw Error('Target stature outside supported range');
  const shifts=new Map(),rotations=new Map();
  for(const s of target.attachmentSurfaces||[]){
    let surface=s.anchor===69?-Infinity:Infinity;
    for(let i=0;i<fitted.positions.length/3;i++){
      let weight=0;for(let k=0;k<slots;k++)if(s.bones.includes(fitted.joints[i*slots+k]))weight+=fitted.weights[i*slots+k];
      if(weight<=.5)continue;
      const z=vector(s.inverse,fitted.positions.subarray(i*3,i*3+3),1)[2];surface=s.anchor===69?Math.max(surface,z):Math.min(surface,z);
    }
    if(!Number.isFinite(surface))throw Error('Missing attachment surface');
    const difference=surface-s.surface/scale;
    shifts.set(s.anchor,[0,0,s.anchor===69?Math.max(0,difference):Math.min(0,difference)]);
  }
  for(const reference of target.attachmentPoses||[]){
    const points=[];for(let i=0;i<reference.points.length;i+=3)points.push(reference.points.slice(i,i+3));
    const anchor=[reference.pose[3],reference.pose[7],reference.pose[11]],relative=points.map(p=>p.map((x,i)=>x-anchor[i]));
    const pivotY=anchor[1]*scale+offset,minimum=Math.min(...points.map(p=>p[1]));
    const clearance=Math.max(.25,minimum*scale+offset);
    let transform=identity();
    if(Math.min(...relative.map(p=>p[1]+pivotY))<clearance){
      const lowest=relative.reduce((a,b)=>a[1]<b[1]?a:b);let axis=cross(lowest,[0,1,0]);if(Math.hypot(...axis)<1e-8)axis=[0,0,1];
      const height=angle=>Math.min(...relative.map(p=>vector(rotation(axis,angle),p)[1]+pivotY));
      let lo=0,found=false;
      for(let step=1;step<=180;step++){
        let hi=step*Math.PI/360;
        if(height(hi)>=clearance){for(let i=0;i<40;i++){const mid=(lo+hi)/2;if(height(mid)>=clearance)hi=mid;else lo=mid;}transform=rotation(axis,hi);found=true;break;}lo=hi;
      }
      if(!found)throw Error('Attachment cannot clear the idle floor');
    }
    // Rotate in the animated anchor's local coordinates, without translation.
    const pose=[...reference.pose],inverse=[...reference.inverse];for(const m of [pose,inverse])m[3]=m[7]=m[11]=0;
    rotations.set(reference.anchor,mul(mul(inverse,transform),pose));
  }
  return {scale,offset,attachments:(target.attachments||[]).map(a=>{
    const correction=[...(rotations.get(a.anchor)||identity())];for(const r of [0,1,2])for(const c of [0,1,2])correction[r*4+c]/=scale;
    const shift=shifts.get(a.anchor)||[0,0,0];for(let i=0;i<3;i++)correction[i*4+3]=shift[i];
    const transform=mul(mul(a.left,correction),a.right);
    // Bind matrices are rigid and the correction has uniform positive scale.
    return a.arrays.map(row=>({offset:row.offset,value:row.normal?normalized(vector(transform,row.value)):vector(transform,row.value,1)}));
  }).flat()};
}
