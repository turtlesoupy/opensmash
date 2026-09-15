// Row-major CPU matrices; column-major upload. No automatic normalization or
// proportion correction is allowed in the renderer.
export const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function multiply(a,b){const out=new Array(16).fill(0);for(let r=0;r<4;r++)for(let c=0;c<4;c++)for(let k=0;k<4;k++)out[r*4+c]+=a[r*4+k]*b[k*4+c];return out;}
export function worldMatrices(skeleton,pose,buildLocal){
 const worlds=[],scales=[];
 for(let i=0;i<skeleton.length;i++){
  const j=skeleton[i],p=j.parent;
  if(j.flags&((1<<12)|(1<<17)|(1<<23)|(1<<24)|(1<<25)))throw Error('Unsupported joint matrix flags');
  const [x,y,z,tx,ty,tz,sx,sy,sz]=Array.from(pose.slice(i*9,i*9+9));
  const cx=Math.cos(x),cy=Math.cos(y),cz=Math.cos(z),rx=Math.sin(x),ry=Math.sin(y),rz=Math.sin(z);
  const ps=p===null?null:scales[p];
  scales[i]=(j.flags&8)?ps:(ps?[sx*ps[0],sy*ps[1],sz*ps[2]]:[sx,sy,sz]);
  // HSD_MtxSRT: parent scale compensation, including non-uniform scales.
  const pc=ps||[1,1,1];if(pc.some(v=>Math.abs(v)<1e-12))throw Error('Singular parent scale');
  const m=[cz*sx*cy,sy*pc[1]/pc[0]*(cz*rx*ry-cx*rz),sz*pc[2]/pc[0]*(cz*cx*ry+rx*rz),tx,
   sx*pc[0]/pc[1]*rz*cy,sy*(rz*rx*ry+cx*cz),sz*pc[2]/pc[1]*(rz*cx*ry-rx*cz),ty,
   -sx*pc[0]/pc[2]*ry,sy*pc[1]/pc[2]*cy*rx,sz*cy*cx,tz,0,0,0,1];
  const local=buildLocal?buildLocal(Array.from(pose.slice(i*9,i*9+9)),ps):m;
  worlds.push(p===null?local:multiply(worlds[p],local));
 }
 return worlds;
}
export function skinMatrices(worlds,skeleton){const out=new Float32Array(skeleton.length*16);worlds.forEach((m,i)=>{const inverse=skeleton[i].inverse_bind?.flat()||identity();const skin=multiply(m,inverse);for(let r=0;r<4;r++)for(let c=0;c<4;c++)out[i*16+c*4+r]=skin[r*4+c];});return out;}

export function hsdMatrixBuilder(engine){
 const input=new Float32Array(engine.memory.buffer,engine.port_srt_input(),12);
 return (pose,parentScale)=>{
  input.set(pose);input.set(parentScale||[1,1,1],9);
  const out=Array.from(new Float32Array(engine.memory.buffer,engine.port_srt(parentScale?1:0),12));
  return [...out,0,0,0,1];
 };
}

export function cameraMatrix(view){
 const angle={side:Math.PI/2,front:0,three:Math.PI/4}[view];
 if(angle===undefined)throw Error('Unknown camera');
 const c=Math.cos(angle),s=Math.sin(angle);
 return new Float32Array([c/14,0,-s/100,0, 0,1/10.5,0,0, -s/14,0,-c/100,0, 0,-.72,0,1]);
}
