export function parseMesh(raw,palette){
 const h=new DataView(raw);if(raw.byteLength<16||h.getUint32(0,true)!==0x474d534f||h.getUint32(4,true)!==1)throw Error('Unsupported character mesh');
 const vertices=h.getUint32(8,true),indices=h.getUint32(12,true),end=16+vertices*40+indices*4;
 if(!vertices||vertices>65535||indices%3||end!==raw.byteLength)throw Error('Invalid character geometry');
 const indexData=new Uint32Array(raw,16+vertices*40,indices);
 for(const i of indexData)if(i>=vertices)throw Error('Mesh index exceeds vertex count');
 for(let i=0;i<vertices;i++){
  const p=16+i*40;let sum=0;
  for(let c=0;c<5;c++)if(!Number.isFinite(h.getFloat32(p+c*4,true)))throw Error('Non-finite vertex');
  for(let k=0;k<4;k++){const w=h.getFloat32(p+24+k*4,true);if(!Number.isFinite(w)||w<0||h.getUint8(p+20+k)>=palette)throw Error('Invalid skin weight');sum+=w;}
  if(Math.abs(sum-1)>2e-6)throw Error('Unnormalized skin weights');
 }
 return {vertices,indices,vertexData:new Uint8Array(raw,16,vertices*40),indexData};
}
export function camera(bounds,angle,aspect=4/3){
 const [lo,hi]=bounds,cy=(lo[1]+hi[1])/2;
 const half=Math.max((hi[1]-lo[1])*0.67,Math.hypot(hi[0]-lo[0],hi[2]-lo[2])/(2*aspect)*1.18);
 const c=Math.cos(angle),s=Math.sin(angle),x=half*aspect,depth=1000;
 return new Float32Array([c/x,0,-s/depth,0,0,1/half,0,0,-s/x,0,-c/depth,0,0,-cy/half,0,1]);
}
export async function createViewer(canvas,fighter,onStatus,signal){
 const get=async url=>{const r=await fetch(url,{signal});if(!r.ok)throw Error(`Character asset unavailable (${r.status})`);return r;};
 const [meta,raw,poseRaw,imageBlob]=await Promise.all([get(`/motion/${fighter.target}.json`).then(r=>r.json()),get(`/models/${fighter.slug}.bin`).then(r=>r.arrayBuffer()),get(`/motion/${fighter.target}.bin`).then(r=>r.arrayBuffer()),get(`/models/${fighter.slug}.webp`).then(r=>r.blob())]);
 if(signal.aborted)return;
 const mesh=parseMesh(raw,meta.palette),poses=new Float32Array(poseRaw);
 if(meta.palette>32||!poses.every(Number.isFinite))throw Error('Unsupported pose data');
 for(const clip of meta.clips)if(clip.frames<=0||clip.offset<0||clip.offset+clip.frames*meta.palette*16>poses.length)throw Error('Invalid clip bounds');
 const image=await createImageBitmap(imageBlob);if(signal.aborted){image.close();return;}
 const gl=canvas.getContext('webgl2',{alpha:true,antialias:true});if(!gl){image.close();throw Error('Your browser does not support WebGL 2. Try Safari or Chrome.');}
 const shaders=[],buffers=[];let stopped=false,raf=0,playing=true,clip=meta.clips[0],time=0,last=0,angle=Math.PI/4,bind=false,drag=null;
 function shader(type,source){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 const program=gl.createProgram();
 gl.attachShader(program,shader(gl.VERTEX_SHADER,`#version 300 es
 precision highp float;layout(location=0)in vec3 position;layout(location=1)in vec2 uv;layout(location=2)in vec4 joints;layout(location=3)in vec4 weights;
 uniform mat4 bones[32];uniform mat4 camera;out vec2 texcoord;
 void main(){mat4 skin=bones[int(joints.x)]*weights.x+bones[int(joints.y)]*weights.y+bones[int(joints.z)]*weights.z+bones[int(joints.w)]*weights.w;gl_Position=camera*skin*vec4(position,1.);texcoord=uv;}`));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`#version 300 es
 precision highp float;in vec2 texcoord;uniform sampler2D atlas;out vec4 color;
 void main(){color=texture(atlas,texcoord);if(color.a<.05)discard;}`));
 gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const vb=gl.createBuffer(),ib=gl.createBuffer();buffers.push(vb,ib);
 gl.bindBuffer(gl.ARRAY_BUFFER,vb);gl.bufferData(gl.ARRAY_BUFFER,mesh.vertexData,gl.STATIC_DRAW);
 [[3,gl.FLOAT,0],[2,gl.FLOAT,12],[4,gl.UNSIGNED_BYTE,20],[4,gl.FLOAT,24]].forEach(([size,type,offset],i)=>{gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,size,type,false,40,offset);});
 gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,mesh.indexData,gl.STATIC_DRAW);
 const texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);image.close();
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(0,0,0,0);
 const boneLocation=gl.getUniformLocation(program,'bones[0]'),cameraLocation=gl.getUniformLocation(program,'camera');
 const identity=new Float32Array(meta.palette*16);for(let i=0;i<meta.palette;i++)for(let k=0;k<16;k++)identity[i*16+k]=k%5===0?1:0;
 function draw(now){
  if(stopped)return;
  if(last&&playing&&!bind&&document.visibilityState==='visible')time+=Math.min((now-last)/1000,.1);last=now;
  const frame=Math.floor(time*clip.fps)%clip.frames,offset=clip.offset+frame*meta.palette*16;
  gl.viewport(0,0,canvas.width,canvas.height);gl.uniformMatrix4fv(boneLocation,false,bind?identity:poses.subarray(offset,offset+meta.palette*16));
  gl.uniformMatrix4fv(cameraLocation,false,camera(fighter.bounds,angle,canvas.width/canvas.height));gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.drawElements(gl.TRIANGLES,mesh.indices,gl.UNSIGNED_INT,0);
  raf=requestAnimationFrame(draw);
 }
 const down=event=>{drag={x:event.clientX,angle};canvas.setPointerCapture(event.pointerId);};
 const move=event=>{if(drag)angle=drag.angle+(event.clientX-drag.x)*.009;};const up=()=>{drag=null;};
 canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointercancel',up);
 const lost=event=>{event.preventDefault();onStatus({state:'error',message:'Graphics paused. Reopen this fighter to reload.'});};canvas.addEventListener('webglcontextlost',lost);
 const dispose=()=>{if(stopped)return;stopped=true;cancelAnimationFrame(raf);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointercancel',up);canvas.removeEventListener('webglcontextlost',lost);for(const b of buffers)gl.deleteBuffer(b);gl.deleteTexture(texture);for(const s of shaders)gl.deleteShader(s);gl.deleteProgram(program);};
 signal.addEventListener('abort',dispose,{once:true});if(signal.aborted){dispose();return;}
 draw(performance.now());if(gl.getError()!==gl.NO_ERROR){dispose();throw Error('Character renderer could not start');}
 onStatus({state:'ready',vertices:mesh.vertices,triangles:mesh.indices/3,target:fighter.target});
 return {setClip(id){bind=id==='bind';if(!bind){const next=meta.clips.find(c=>c.id===id);if(!next)throw Error('Unknown animation');clip=next;time=0;}},setPlaying(value){playing=value;},setView(value){angle={front:0,side:Math.PI/2,three:Math.PI/4}[value]??Math.PI/4;},dispose};
}
