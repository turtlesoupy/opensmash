/** Direct-C backend implementing the shared launcher's worker protocol. */
const prefix=self.location.pathname.startsWith('/melee/')?'/melee':'';
const base=prefix+'/engine/';
let createMelee,inspectDisc;
let sceneReady;
let build;
const dependencies=(async()=>{
 const response=await fetch(base+'direct-c/melee-direct-build.json');if(!response.ok)throw Error('Build the direct-C engine before launching.');build=await response.json();
 const [runtime,disc,preparation]=await Promise.all([import(base+'direct-c/melee-direct.mjs?v='+build.wasmSha256),import(base+'disc.mjs'),import(base+'scene-preparation.mjs')]);
 createMelee=runtime.default;inspectDisc=disc.inspectDisc;sceneReady=preparation.sceneReady;
})();
let game,startOptions,selection,ready=false,pending=false,started=0,lastTime=0,lastFrame=0,previousFrameTime=0;
let audioOverruns=0,presentedFrames=0;
let combatWindow,introReported=false,preparationSamples=[],preparationStarted=0,preparationFailed=false;
let combatFrames=0,playable=false,audioFrames=0,audioPeak=0,phase=0,previous=[0,0],frameTimes=[],intervalCombat=true;
const pads=Array.from({length:4},()=>({buttons:0,until:new Uint32Array(16)}));
const report=(type,data={})=>postMessage({type,...data});
const fail=error=>report('error',{message:error?.stack||String(error||'The direct-C runtime aborted; see the game log.')});
function applyPad(port,frame){
 const pad=pads[port];if(!pad.values)return;
 const [,,sticks,triggers,connected]=pad.values;let buttons=pad.buttons;
 for(let b=0;b<16;b++)if(frame<pad.until[b])buttons|=1<<b;
 game._direct_set_pad(port,buttons,(sticks&255)-128,((sticks>>>8)&255)-128,((sticks>>>16)&255)-128,(sticks>>>24)-128,triggers&255,(triggers>>>8)&255,connected);
}
function setPad(values){
 if(!game)return;const [port,raw]=values;if(port<0||port>3)return;
 const pad=pads[port],frame=game._direct_frame_count();
 for(let b=0;b<16;b++){const mask=1<<b;if((raw&mask)&&!(pad.buttons&mask))pad.until[b]=frame+2;}
 pad.buttons=raw;pad.values=values;applyPad(port,frame);
}

function mix(samples,rate){
 audioFrames+=samples.length/2;for(let i=0;i<samples.length;i++)audioPeak=Math.max(audioPeak,Math.abs(samples[i]));
 if(!startOptions.audio)return;
 const indices=new Int32Array(startOptions.audio,0,4),ring=new Float32Array(startOptions.audio,16),cap=ring.length/2;
 let w=Atomics.load(indices,0),r=Atomics.load(indices,1);
 for(let i=0;i<samples.length;i+=2){while(phase<1){const next=(w+1)%cap;if(next!==r){ring[w*2]=(previous[0]+(samples[i]-previous[0])*phase)/32768;ring[w*2+1]=(previous[1]+(samples[i+1]-previous[1])*phase)/32768;w=next;}else audioOverruns++;phase+=rate/48000;}phase-=1;previous[0]=samples[i];previous[1]=samples[i+1];}
 Atomics.store(indices,0,w);
}
function onFrame(frame){
 for(let port=0;port<4;port++)applyPad(port,frame);
 const now=performance.now(),scene=game._direct_scene(),sceneKind=game._direct_scene_kind(),combat=sceneKind===2&&game._opensmash_preparation_state()===4;
 const preparing=game._opensmash_intro_state()===1||game._opensmash_preparation_state()===2;
 if(game._opensmash_intro_state()===1)introReported=false;
 if(!preparing)preparationStarted=0;else if(!preparationStarted)preparationStarted=now;
 if(preparing&&now-preparationStarted>60000&&!preparationFailed){preparationFailed=true;fail('The scene could not finish preparing. Close other running games and try again.');}
 if(previousFrameTime)preparationSamples.push(now-previousFrameTime);if(preparationSamples.length>30)preparationSamples.shift();
 if(sceneReady(preparationSamples)){if(game._opensmash_intro_state()===1)game._opensmash_finish_intro_preparation();if(game._opensmash_preparation_state()===2)game._opensmash_finish_preparation();}
 intervalCombat=intervalCombat&&combat;
 if(combat)combatFrames++;
 const audio=startOptions.audio?new Int32Array(startOptions.audio,0,4):null;
 if(!combat)combatWindow=null;
 else if(!combatWindow)combatWindow={start:now,frame,presented:presentedFrames,overruns:audioOverruns,samples:[],underruns:audio?Atomics.load(audio,2):0,rendered:audio?Atomics.load(audio,3):0};
 else {
  combatWindow.samples.push(now-previousFrameTime);
  if(now-combatWindow.start>=30000){
   const w=combatWindow,durationMs=now-w.start,ordered=w.samples.sort((a,b)=>a-b);
   report('combat-performance',{profile:'0',presentedBitmapFps:(presentedFrames-w.presented)*1000/durationMs,audioOverrunSamples:audioOverruns-w.overruns,maxFrameMs:ordered.at(-1),frames:frame-w.frame,combatFrames,durationMs,fps:(frame-w.frame)*1000/durationMs,p95:ordered[Math.floor(ordered.length*.95)],p99:ordered[Math.floor(ordered.length*.99)],over33ms:ordered.filter(n=>n>33.34).length,audioPeak,audioUnderrunSamples:(audio?Atomics.load(audio,2):0)-w.underruns,audioRenderedSamples:(audio?Atomics.load(audio,3):0)-w.rendered,targetFps:60});
   combatWindow=null;
  }
 }
 if(previousFrameTime)frameTimes.push(now-previousFrameTime);previousFrameTime=now;
 if(now-lastTime>=1000){const fps=(frame-lastFrame)*1000/(now-lastTime);
 report('progress',{frame,scene,sceneKind,audioIndices:audio?Array.from(audio):null,resamplePhase:phase,audioFrames,audioPeak,fps});
 report('metrics',{frames:frame,combatFrames,fps,frameTimes,completeCombatInterval:intervalCombat});
 lastFrame=frame;lastTime=now;frameTimes=[];intervalCombat=true;
 }
}
function present(canvas){
 const intro=game._opensmash_intro_state();
 if(intro===1||game._opensmash_preparation_state()===2)return;
 if(intro===2&&!introReported){introReported=true;report('intro');}
 if(pending)return;pending=true;
 createImageBitmap(canvas).then(bitmap=>{
  postMessage({type:'frame',bitmap},[bitmap]);presentedFrames++;
  const scene=game._direct_scene(),mode=selection?.launch?.mode;
  const reached=mode===0?game._direct_scene_kind()===2&&game._opensmash_preparation_state()===4&&combatFrames>1:mode===1?(scene>>>8)===1:mode===2?(scene>>>8)===2:mode===3?(scene>>>8)===3:true;
  if(reached&&!playable){playable=true;report('playable');report('log',{text:'[opensmash] destination ready'});report('startup-performance',{clickToMatchMs:Date.now()-(selection.requestedAt||Date.now())});}
 }).catch(fail).finally(()=>pending=false);
}
async function select(data){
 if(!game||!ready)throw Error('The direct-C engine is not ready for selection.');ready=false;selection=data;
 const {COSTUME_SLOTS}=await import(base+'local-files.mjs');
 const css=['MnSlChr.dat','MnSlChr.usd','audio/nr_select.ssm','audio/us/nr_select.ssm'];
 for(const [assets,allowed,max] of [[data.costumes||[],COSTUME_SLOTS,2*1024*1024],[data.cssAssets||[],css,16*1024*1024]]){
  for(const asset of assets){if(!allowed.includes(asset.filename))throw Error('Invalid replacement asset.');const bytes=new Uint8Array(await asset.blob.arrayBuffer());if(bytes.length<32||bytes.length>max)throw Error('Invalid replacement asset size.');const path='/mod/'+asset.filename;game.FS.mkdirTree(path.slice(0,path.lastIndexOf('/')));game.FS.writeFile(path,bytes);}
 }
 const c=data.launch;if(!c||!game._direct_configure(c.mode,c.stage,c.level,c.stocks,c.minutes,...c.packedPorts))throw Error('Invalid match configuration.');
 report('session',{backend:'direct-c',build,browser:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,launch:c});report('status',{message:'Opening Melee…'});report('started');started=lastTime=performance.now();
 game.callMain(['--iso','/disc/game.iso','--mod','/mod','--saves','/saves','--quiet-stubs',...(startOptions.args||[])]);
}
self.onmessage=async({data})=>{
 try{
  if(data.type==='pad'){setPad(data.values);return;}
  if(data.type==='input'){game?._direct_set_pad(...data.values);return;}
  if(data.type==='confirm'){setPad([0,256,0x80808080,0,1]);setPad([0,0,0x80808080,0,1]);return;}
  if(data.type==='select'){await select(data);return;}
  if(data.type!=='start'||startOptions)return;startOptions=data;
  report('status',{message:'Checking your local Melee disc…'});await dependencies;if(!data.iso||data.iso.size!==1459978240)throw Error('Choose the full, unmodified USA 1.02 Melee disc.');
  const canvas=new OffscreenCanvas(960,720);
  const log=text=>report('log',{text,message:text});
  game=await createMelee({noInitialRun:true,locateFile:path=>base+'direct-c/'+path+'?v='+build.wasmSha256,canvas,print:log,printErr:log,
   preRun:[m=>{m.FS.mkdir('/disc');m.FS.mount(m.FS.filesystems.WORKERFS,{blobs:[{name:'game.iso',data:data.iso}]},'/disc');m.FS.mkdir('/saves');m.FS.mount(m.FS.filesystems.IDBFS,{autoPersist:true},'/saves');m.FS.mkdir('/mod');if(data.profile)m.ENV.MELEE_GX_PROFILE='1';}],
   onVerifyProgress:bytes=>report('status',{message:'Checking your game… '+Math.floor(bytes/1459978240*100)+'%'}),onAudio:mix,onFrame,onPresent:()=>present(canvas),onExit:status=>{report('exit',{status});if(status)fail('Melee stopped with status '+status+'. See the game log for details.');},onAbort:fail});
  if(!data.discVerified&&!game._direct_verify_disc())throw Error('This image does not match the known USA 1.02 Melee disc hash.');
  await inspectDisc(data.iso);report('disc-verified');
  await new Promise((resolve,reject)=>game.FS.syncfs(true,error=>error?reject(error):resolve()));
  ready=true;report('ready-for-selection');
  if(data.launch){const [mode,stage,level,stocks,minutes,...packedPorts]=data.launch;await select({launch:{mode,stage,level,stocks,minutes,packedPorts},costumes:data.costumes||[],cssAssets:data.cssAssets||[]});}
 }catch(error){fail(error);}
};
