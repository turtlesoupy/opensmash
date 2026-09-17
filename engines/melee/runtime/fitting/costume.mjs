import {preparePresentation} from './presentation.mjs';
/** Append native fitted geometry to a locally derived target costume.
 * HSD layout matches opensmash_melee/browser_skin.py; all offsets are data-relative.
 */
class Archive {
  constructor(raw) {
    const v=new DataView(raw);
    if(raw.byteLength<32||v.getUint32(0)!==raw.byteLength)throw Error('Invalid costume header');
    const size=v.getUint32(4),nr=v.getUint32(8),np=v.getUint32(12),ne=v.getUint32(16);
    const end=32+size+nr*4+(np+ne)*8;
    if(end>raw.byteLength)throw Error('Invalid costume tables');
    this.header=new Uint8Array(raw.slice(20,32));this.bytes=new Uint8Array(Math.max(4*1024*1024,size));
    this.bytes.set(new Uint8Array(raw,32,size));this.size=size;this.v=new DataView(this.bytes.buffer);
    let p=32+size;this.relocs=new Set();
    for(let i=0;i<nr;i++,p+=4){const field=v.getUint32(p);if(field%4||field+4>size||this.v.getUint32(field)>=size)throw Error('Invalid relocation');this.relocs.add(field);}
    this.public=[];this.external=[];
    for(const [count,rows] of [[np,this.public],[ne,this.external]])for(let i=0;i<count;i++,p+=8)rows.push([v.getUint32(p),v.getUint32(p+4)]);
    this.strings=new Uint8Array(raw.slice(end));
  }
  alloc(n,align=4){const p=Math.ceil(this.size/align)*align,end=p+n;if(end>16*1024*1024)throw Error('Costume exceeds allocation limit');
    if(end>this.bytes.length){const b=new Uint8Array(Math.max(end,this.bytes.length*2));b.set(this.bytes);this.bytes=b;this.v=new DataView(b.buffer);}this.size=end;return p;}
  u32(p,x){this.v.setUint32(p,x);} u16(p,x){this.v.setUint16(p,x);} f32(p,x){this.v.setFloat32(p,x);}
  pointer(p,x){if(x===null){this.u32(p,0);this.relocs.delete(p);}else{if(!Number.isInteger(x)||x<0||x>=this.size)throw Error('Invalid costume pointer');this.u32(p,x);this.relocs.add(p);}}
  append(bytes,align=4){const p=this.alloc(bytes.length,align);this.bytes.set(bytes,p);return p;}
  floats(values){const p=this.alloc(values.length*4,32);values.forEach((x,i)=>this.f32(p+i*4,x));return p;}
  serialize(){const relocs=[...this.relocs].sort((a,b)=>a-b);const size=32+this.size+relocs.length*4+(this.public.length+this.external.length)*8+this.strings.length;
    if(size>2*1024*1024)throw Error('Costume exceeds the engine’s 2 MiB slot');
    const raw=new Uint8Array(size),v=new DataView(raw.buffer);[size,this.size,relocs.length,this.public.length,this.external.length].forEach((x,i)=>v.setUint32(i*4,x));raw.set(this.header,20);raw.set(this.bytes.subarray(0,this.size),32);
    let p=32+this.size;for(const field of relocs){v.setUint32(p,field);p+=4;}for(const row of [...this.public,...this.external]){v.setUint32(p,row[0]);v.setUint32(p+4,row[1]);p+=8;}raw.set(this.strings,p);return raw.buffer;
  }
}

export function buildCostume(raw,source,target,fitted,texture,color=0,identityRaw=null){
  const a=new Archive(raw),n=source.n,slots=target.mode==='round'?5:4;
  const presentation=preparePresentation(target,fitted);
  for(const row of presentation.attachments)row.value.forEach((v,i)=>a.f32(row.offset+i*4,v));
  if(source.uv.length!==n*2||source.triangles.length!==source.triangleCount*3||texture.byteLength!==source.textureSize**2*4)throw Error('Invalid source surface');
  const pos=a.floats(fitted.positions),normal=a.floats(fitted.normals),uv=a.floats(source.uv);
  const srcpos=a.floats(fitted.positions),srcnormal=a.floats(fitted.normals);
  const bones=[...new Set(fitted.joints)].filter(j=>j!==0xffffffff).sort((a,b)=>a-b);
  if(!bones.length||bones.some(j=>j>=target.jointOffsets.length))throw Error('Invalid fitted joint');
  const boneIndex=new Map(bones.map((j,i)=>[j,i])),envs=[],envIndex=new Map(),vertexEnvs=[];
  for(let i=0;i<n;i++){const env=[];for(let k=0;k<slots;k++){const j=fitted.joints[i*slots+k],w=fitted.weights[i*slots+k];if(j!==0xffffffff)env.push([boneIndex.get(j),w]);}
    if(!env.length)throw Error('Empty fitted envelope');const key=JSON.stringify(env);if(!envIndex.has(key)){envIndex.set(key,envs.length);envs.push(env);}vertexEnvs.push(envIndex.get(key));}
  const records=a.alloc(envs.length*4);
  envs.forEach((original,i)=>{const env=original.length===1?[[original[0][0],.5],[original[0][0],.5]]:original;
    const record=a.alloc(4+env.length*8);a.u32(record,env.length);env.forEach(([j,w],k)=>{a.u32(record+4+k*8,j);a.f32(record+8+k*8,w);});a.pointer(records+i*4,record);});
  const vertexEnv=a.alloc(n*2);vertexEnvs.forEach((e,i)=>a.u16(vertexEnv+i*2,e));
  const metadata=a.alloc(48);[0x4f53534b,1,n,envs.length,bones.length].forEach((x,i)=>a.u32(metadata+i*4,x));
  [srcpos,srcnormal,records,vertexEnv,pos,normal].forEach((ptr,i)=>a.pointer(metadata+20+i*4,ptr));
  const desc=a.alloc(120);
  [[0,1,0,0,null],[9,3,1,12,pos],[10,3,0,12,normal],[13,3,1,8,uv],[255,0x4f53534b,0,0,metadata]].forEach(([attr,kind,count,stride,ptr],i)=>{const p=desc+i*24;[attr,kind,count,4].forEach((x,k)=>a.u32(p+k*4,x));a.u16(p+18,stride);a.pointer(p+20,ptr);});
  const boneDesc=a.alloc((bones.length+1)*8);bones.forEach((j,i)=>{a.pointer(boneDesc+i*8,target.jointOffsets[j]);a.f32(boneDesc+i*8+4,1/bones.length);});const table=a.alloc(8);a.pointer(table,boneDesc);
  let first=null,previous=null;
  for(let begin=0;begin<source.triangles.length;begin+=65535){const tris=source.triangles.slice(begin,begin+65535);const dl=a.alloc(Math.ceil((3+tris.length*7)/32)*32,32);a.bytes[dl]=0x90;a.u16(dl+1,tris.length);
    tris.forEach((vertex,i)=>{if(!Number.isInteger(vertex)||vertex<0||vertex>=n)throw Error('Invalid triangle index');const p=dl+3+i*7;a.bytes[p]=0;[1,3,5].forEach(k=>a.u16(p+k,vertex));});
    const pobj=a.alloc(24);a.pointer(pobj+8,desc);a.u16(pobj+12,0x2000);a.u16(pobj+14,Math.ceil((3+tris.length*7)/32));a.pointer(pobj+16,dl);a.pointer(pobj+20,table);
    if(first===null)first=pobj;if(previous!==null)a.pointer(previous+4,pobj);previous=pobj;}
  a.pointer(target.dobj+12,first);
  const pixels=a.append(new Uint8Array(texture),32);a.pointer(target.image,pixels);a.u16(target.image+4,source.textureSize);a.u16(target.image+6,source.textureSize);a.u32(target.image+8,6);
  if(identityRaw){
    const identity=new Archive(identityRaw),base=a.append(identity.bytes.subarray(0,identity.size),32);
    for(const field of identity.relocs)a.pointer(base+field,base+identity.v.getUint32(field));
    const original=base+source.identityMaterial;
    a.f32(original+68,presentation.scale);a.f32(original+72,presentation.offset);
    // Fit the portrait camera using the final head envelope in target bind space.
    const points=[],inv=target.headInverse;
    for(let i=0;i<n;i++){let weight=0;for(let k=0;k<slots;k++)if(fitted.joints[i*slots+k]===target.headJoint)weight+=fitted.weights[i*slots+k];
      if(weight>=.5){const v=fitted.positions.subarray(i*3,i*3+3);points.push([0,1,2].map(r=>inv[r*4]*v[0]+inv[r*4+1]*v[1]+inv[r*4+2]*v[2]+inv[r*4+3]));}}
    if(points.length>=4){const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(const p of points)for(let k=0;k<3;k++){low[k]=Math.min(low[k],p[k]);high[k]=Math.max(high[k],p[k]);}
      const center=low.map((x,k)=>(x+high[k])/2),radius=Math.max(...points.map(p=>Math.hypot(...p.map((x,k)=>x-center[k]))));
      a.pointer(original+48,target.jointOffsets[target.headJoint]);[...center,radius].forEach((x,k)=>a.f32(original+52+k*4,x));}
    for(const dobj of new Set([target.dobj,target.rootDobj])){
      const old=a.v.getUint32(dobj+8),m=a.append(a.bytes.slice(original,original+144));
      // Retain the fighter's original material inputs, extending only identity.
      a.bytes.set(a.bytes.slice(old,old+24),m);
      for(let k=0;k<144;k+=4){const from=k<24?old+k:original+k;if(a.relocs.has(from))a.pointer(m+k,a.v.getUint32(from));}
      a.pointer(dobj+8,m);
    }
  }
  if(target.templateColor!==color)throw Error('Costume template does not match selected color');
  return a.serialize();
}
