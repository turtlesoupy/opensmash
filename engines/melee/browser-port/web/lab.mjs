import {identity,multiply,worldMatrices,skinMatrices,hsdMatrixBuilder,cameraMatrix} from './matrices.mjs';
const $=id=>document.getElementById(id);
let e,data,characters,character,gl,program,mesh,texture,animation,playing=true,bindMode=false;
let ticks=0,last=0,accumulator=0,draws=0,start=performance.now(),supported=[],vertexData,boneLocation,cameraLocation,buildLocal;
function check(code,message){if(code!==0)throw Error(`${message}: ${code}`);}
function status(){ $('status').textContent=`WebAssembly · original HSD FObj/AObj\n${supported.length} skeleton-compatible animations · ${character.vertices/3} triangles · ${data.skeleton.length} joints\n${ticks} engine ticks · ${draws} browser frames · ${bindMode?'bind pose':animation.name.replace(/^.*ACTION_|_figatree$/g,'')}\nWebGL: ${gl.getError()===gl.NO_ERROR?'OK':'ERROR'}`; }
function fail(err){playing=false;$('error').textContent=err.stack||String(err);console.error(err);}
function loadAnimation(){
 animation=supported[Number($('animation').value)];bindMode=false;
 check(e.port_begin(animation.joints,animation.frames,1),'Initialize HSD');
 const bind=new Float32Array(e.memory.buffer,e.port_bind(),animation.joints*9);
 data.skeleton.forEach((j,i)=>bind.set([...j.rotation,...j.position,...j.scale],i*9));
 for(const t of animation.tracks){
  const raw=Uint8Array.from(atob(t.data),c=>c.charCodeAt(0));
  new Uint8Array(e.memory.buffer,e.port_input(),raw.length).set(raw);
  check(e.port_add_track(t.joint,t.channel,t.value,t.slope,raw.length,t.start),'Load HSD track');
 }
 check(e.port_seek(0),'Seek HSD');$('frame').max=Math.max(0,Math.ceil(animation.frames)-1);accumulator=0;
}
function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
function initGL(){
 gl=$('canvas').getContext('webgl2',{antialias:true,preserveDrawingBuffer:true});if(!gl)throw Error('WebGL 2 is required');
 program=gl.createProgram();
 gl.attachShader(program,shader(gl.VERTEX_SHADER,`#version 300 es
 precision highp float;
 layout(location=0)in vec3 position;layout(location=1)in vec2 uv;layout(location=2)in vec4 joints;layout(location=3)in vec4 weights;
 uniform mat4 bones[64];uniform mat4 camera;out vec2 texcoord;out vec3 worldPosition;
 void main(){mat4 skin=bones[int(joints.x)]*weights.x+bones[int(joints.y)]*weights.y+bones[int(joints.z)]*weights.z+bones[int(joints.w)]*weights.w;vec4 world=skin*vec4(position,1.);worldPosition=world.xyz;gl_Position=camera*world;texcoord=uv;}`));
 gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`#version 300 es
 precision highp float;in vec2 texcoord;uniform sampler2D atlas;out vec4 color;
 void main(){color=texture(atlas,texcoord);if(color.a<.05)discard;}`));
 gl.transformFeedbackVaryings(program,['worldPosition'],gl.INTERLEAVED_ATTRIBS);
 gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
 boneLocation=gl.getUniformLocation(program,'bones[0]');cameraLocation=gl.getUniformLocation(program,'camera');
 gl.useProgram(program);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clearColor(.063,.086,.125,1);
 gl.viewport(0,0,960,720);
}
async function loadCharacter(){
 const requested=characters[Number($('character').value)];
 const [raw,image]=await Promise.all([fetch(requested.mesh).then(r=>{if(!r.ok)throw Error(r.status);return r.arrayBuffer();}),new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=requested.texture;})]);
 if(mesh)gl.deleteBuffer(mesh);if(texture)gl.deleteTexture(texture);
 vertexData=new Float32Array(raw);
 mesh=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,mesh);gl.bufferData(gl.ARRAY_BUFFER,raw,gl.STATIC_DRAW);
 let offset=0;[3,2,4,4].forEach((size,i)=>{gl.enableVertexAttribArray(i);gl.vertexAttribPointer(i,size,gl.FLOAT,false,52,offset*4);offset+=size;});
 texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
 gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
 gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
 character=requested;
}
function draw(){
 const pose=bindMode?data.skeleton.flatMap(j=>[...j.rotation,...j.position,...j.scale]):new Float32Array(e.memory.buffer,e.port_pose(),data.skeleton.length*9);
 const bones=skinMatrices(worldMatrices(data.skeleton,pose,buildLocal),data.skeleton);
 // Equal framing in every view; no per-pose auto-fit to hide proportions.
 const camera=cameraMatrix($('view').value);
 gl.uniformMatrix4fv(boneLocation,false,bones);
 gl.uniformMatrix4fv(cameraLocation,false,camera);
 gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.drawArrays(gl.TRIANGLES,0,character.vertices);
 $('frame').value=String(Math.floor(e.port_frame()));$('frame-value').textContent=String(Math.floor(e.port_frame()));draws++;
}
function gpuError(){
 draw();
 const pose=bindMode?data.skeleton.flatMap(j=>[...j.rotation,...j.position,...j.scale]):new Float32Array(e.memory.buffer,e.port_pose(),data.skeleton.length*9);
 const bones=skinMatrices(worldMatrices(data.skeleton,pose,buildLocal),data.skeleton);
 const feedback=gl.createBuffer();gl.bindBuffer(gl.TRANSFORM_FEEDBACK_BUFFER,feedback);
 gl.bufferData(gl.TRANSFORM_FEEDBACK_BUFFER,character.vertices*12,gl.STREAM_READ);
 gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,feedback);gl.enable(gl.RASTERIZER_DISCARD);
 gl.beginTransformFeedback(gl.TRIANGLES);gl.drawArrays(gl.TRIANGLES,0,character.vertices);gl.endTransformFeedback();gl.disable(gl.RASTERIZER_DISCARD);
 const gpu=new Float32Array(character.vertices*3);gl.getBufferSubData(gl.TRANSFORM_FEEDBACK_BUFFER,0,gpu);
 gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER,0,null);gl.deleteBuffer(feedback);
 if(gl.getError()!==gl.NO_ERROR)throw Error('GPU transform feedback failed');
 let max=0;
 for(let v=0;v<character.vertices;v++)for(let axis=0;axis<3;axis++){
  const off=v*13;let expected=0;
  for(let k=0;k<4;k++){
   const b=vertexData[off+5+k]*16,w=vertexData[off+9+k];
   expected+=w*(bones[b+axis]*vertexData[off]+bones[b+4+axis]*vertexData[off+1]+bones[b+8+axis]*vertexData[off+2]+bones[b+12+axis]);
  }
  const err=Math.abs(gpu[v*3+axis]-expected);if(!Number.isFinite(err))throw Error('Non-finite GPU position');max=Math.max(max,err);
 }
 if(max>1e-4)throw Error(`GPU skinning mismatch: ${max}`);
 return max;
}
async function validateGPU(){
 const previousCharacter=$('character').value,previousAnimation=$('animation').value;
 playing=false;$('play').textContent='Play';for(const id of ['validate','character','animation','play','bind','frame'])$(id).disabled=true;
 const results=[];
 try{
  for(let c=0;c<characters.length;c++){
   $('character').value=String(c);await loadCharacter();bindMode=true;
   results.push({character:character.slug,pose:'bind',max_error:gpuError()});
   for(const [name,frame] of [['Wait1',0],['Wait1',25],['Run',7],['Attack11',5],['AttackAirF',10],['DamageN1',5],['SpecialHi',8]]){
    const index=supported.findIndex(a=>a.name.endsWith(`ACTION_${name}_figatree`));if(index<0)throw Error(`Missing ${name}`);
    $('animation').value=String(index);loadAnimation();check(e.port_seek(frame),'Validation seek');
    results.push({character:character.slug,pose:name,frame,max_error:gpuError()});
   }
  }
  $('validation').textContent=`PASS · ${results.length} character/pose checks · maximum GPU position error ${Math.max(...results.map(r=>r.max_error)).toExponential(3)} game units. This checks shader skinning, not combat equivalence.`;
 }finally{
  $('character').value=previousCharacter;await loadCharacter();$('animation').value=previousAnimation;loadAnimation();
  for(const id of ['validate','character','animation','play','bind','frame'])$(id).disabled=false;
 }
}
async function recordClip(){
 if(!MediaRecorder.isTypeSupported('video/webm;codecs=vp9'))throw Error('VP9 recording unavailable');
 for(const id of ['record','validate','character','animation','play','bind','frame','view'])$(id).disabled=true;
 $('capture').textContent='Recording 9 seconds of browser-rendered animation…';
 const oldView=$('view').value;$('view').value='three';
 const stream=$('canvas').captureStream(60),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:3000000}),chunks=[];
 const complete=new Promise((resolve,reject)=>{recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};recorder.onerror=reject;recorder.onstop=resolve;});
 try{
  recorder.start();
  for(const name of ['Wait1','Run','AttackAirF']){
   $('animation').value=String(supported.findIndex(a=>a.name.endsWith(`ACTION_${name}_figatree`)));loadAnimation();playing=true;
   await new Promise(resolve=>setTimeout(resolve,3000));
  }
  recorder.stop();await complete;playing=false;$('play').textContent='Play';
  const response=await fetch('/capture',{method:'POST',headers:{'Content-Type':'video/webm'},body:new Blob(chunks,{type:'video/webm'})});
  if(!response.ok)throw Error('Local capture service unavailable; use tools/serve_browser_lab.py');
  const result=await response.json();$('capture').textContent=`Saved ${character.slug}: ${result.url}`;
 }finally{if(recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(t=>t.stop());$('view').value=oldView;
 for(const id of ['record','validate','character','animation','play','bind','frame','view'])$(id).disabled=false;}
}
function frame(now){try{
 if(last&&playing&&!bindMode){accumulator+=Math.min((now-last)/1000,.1);while(accumulator>=1/60){check(e.port_step(),'Step HSD');ticks++;accumulator-=1/60;}}
 last=now;draw();if(draws%30===0)status();requestAnimationFrame(frame);
 }catch(err){fail(err);}}
try{
 const [wasm,d,c]=await Promise.all([fetch('melee-animation.wasm').then(r=>r.arrayBuffer()),fetch('mario-local.json').then(r=>r.json()),fetch('characters.json').then(r=>r.json())]);
 e=(await WebAssembly.instantiate(wasm)).instance.exports;buildLocal=hsdMatrixBuilder(e);data=d;characters=c;
 if(data.skeleton.length>64)throw Error('Renderer supports at most 64 joints');
 supported=data.animations.filter(a=>a.joints===data.skeleton.length);
 characters.forEach((c,i)=>$('character').add(new Option(c.slug,i)));
 supported.forEach((a,i)=>$('animation').add(new Option(a.name.replace(/^.*ACTION_|_figatree$/g,''),i)));
 initGL();await loadCharacter();loadAnimation();
 $('character').onchange=async()=>{ $('character').disabled=true;try{await loadCharacter();}catch(err){fail(err);}finally{$('character').disabled=false;} };$('animation').onchange=()=>{try{loadAnimation();}catch(err){fail(err);}};
 $('play').onclick=()=>{if(bindMode)loadAnimation();playing=!playing;$('play').textContent=playing?'Pause':'Play';};
 $('bind').onclick=()=>{bindMode=true;playing=false;$('play').textContent='Play';status();};
 $('frame').oninput=()=>{bindMode=false;playing=false;$('play').textContent='Play';check(e.port_seek(Number($('frame').value)),'Seek HSD');};
 $('record').onclick=()=>recordClip().catch(fail);
 $('validate').onclick=()=>validateGPU().catch(fail);
 status();requestAnimationFrame(frame);
}catch(err){fail(err);}
