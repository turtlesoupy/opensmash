/* Headed, isolated Chrome test. ISO bytes must never cross the network.
 * NODE_PATH=/path/to/node_modules node tools/validate_local_disc.cjs ISO [OUTPUT] [PLAYERS]
 */
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const iso=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]||'build/local-disc-validation');
 const passes=w=>w.fps>=58.5&&w.p95<=20&&w.p99<=33.34&&w.audioUnderrunSamples===0&&(w.audioOverrunSamples===undefined||w.audioOverrunSamples===0)&&w.audioRenderedSamples>=w.durationMs*48*.95;
 const players=Number(process.argv[4]||2),events=[],requests=[],errors=[],samples=[];
 const measuredWindows=Number(process.env.MELEE_WINDOWS||0);
 const lineup=process.env.MELEE_LINEUP||'stock';
 const caseStudy=process.env.MELEE_CASE_STUDY==='1';
 const maxCaseFrameMs=Number(process.env.MELEE_MAX_FRAME_MS||100);
 if(!Number.isFinite(maxCaseFrameMs)||maxCaseFrameMs<=0)throw Error('MELEE_MAX_FRAME_MS must be positive');
 const launchOptions=require('../runtime/launch-options.json');
 const stage=Number(process.env.MELEE_STAGE||31);
 const stockCharacters=(process.env.MELEE_STOCK_CHARACTERS||'8,2,0,6').split(',').map(Number);
 const strictWindows=process.env.MELEE_STRICT_WINDOWS==='1';
 if(!launchOptions.stages.some(s=>s.id===stage))throw Error('Unknown MELEE_STAGE');
 if(stockCharacters.length!==4||stockCharacters.some(id=>!launchOptions.fighters.some(f=>f.id===id)))throw Error('MELEE_STOCK_CHARACTERS must contain four fighter IDs');
 if(process.env.MELEE_STOCK_CHARACTERS&&lineup!=='all-stock')throw Error('MELEE_STOCK_CHARACTERS requires MELEE_LINEUP=all-stock');
 if(strictWindows&&measuredWindows<3)throw Error('Strict windows require MELEE_WINDOWS >= 3');
 if(!Number.isInteger(measuredWindows)||measuredWindows<0||(measuredWindows>0&&measuredWindows<3&&!caseStudy))throw Error('MELEE_WINDOWS must be 0 or at least 3');
 fs.mkdirSync(output,{recursive:true});
 // A persistent profile (MELEE_BROWSER_PROFILE) measures a returning visitor: Chrome's
 // WebAssembly code cache skips baseline compilation of the module on later loads.
 const profileDirectory=process.env.MELEE_BROWSER_PROFILE?path.resolve(process.env.MELEE_BROWSER_PROFILE):fs.mkdtempSync(path.join(output,'profile-'));
 if(process.env.MELEE_BROWSER_PROFILE)fs.mkdirSync(profileDirectory,{recursive:true});
 const chromeArgs=(process.env.MELEE_CHROME_ARGS||'').split(/\s+/).filter(Boolean); // diagnostics only, e.g. --js-flags=--no-liftoff
 const context=await chromium.launchPersistentContext(profileDirectory,{channel:'chrome',headless:false,viewport:{width:1200,height:900},ignoreDefaultArgs:['--mute-audio'],args:chromeArgs});
 const page=context.pages()[0],cdp=process.env.MELEE_TRACE?await context.newCDPSession(context.pages()[0]):null;
 let tracing=false;
 // Keep the profile even when the run fails: a stall is exactly what it should explain.
 const saveTrace=async()=>{
  if(!cdp||!tracing)return;tracing=false;
  const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));await cdp.send('Tracing.end');const {stream}=await complete;let trace='';
  for(;;){const part=await cdp.send('IO.read',{handle:stream});trace+=part.data;if(part.eof)break;}
  fs.writeFileSync(path.join(output,'trace.json'),trace);
  const symbols=path.join(process.env.MELEE_BROWSER_BUILD||'build/moderngekko-wasm','opensmash-web.js.symbols');
  if(fs.existsSync(symbols))fs.copyFileSync(symbols,path.join(output,'opensmash-web.js.symbols'));
  const worker=page.workers().find(w=>w.url().includes('engine-worker'));
  try{fs.writeFileSync(path.join(output,'phases.csv'),await worker.evaluate(()=>engine.FS.readFile('/tmp/frame-phases.csv',{encoding:'utf8'})));}catch{}
 };
 await page.exposeFunction('recordMeleeEvent',data=>{events.push({...data,receivedAt:Date.now()});if(data.type==='combat-performance')console.log(JSON.stringify(data));});
 await page.addInitScript(({players,lineup,stage,stockCharacters,caseStudy})=>{
  if(window.parent!==window)return;
  window.testAudioContexts=[];window.testMeleeError='';window.testPresentedFrames=0;
  const AudioBase=window.AudioContext;
  window.AudioContext=class extends AudioBase {constructor(...args){super(...args);window.testAudioContexts.push(this);}};
  const record=data=>{if(data.type==='frame')window.testPresentedFrames++;if(data.type==='error')window.testMeleeError=data.message;if(!['frame','metrics','pad'].includes(data.type))window.recordMeleeEvent(data);};
  const WorkerBase=window.Worker;
  window.Worker=class extends WorkerBase {constructor(...args){super(...args);this.addEventListener('message',({data})=>record(data));}};
  let engineSource;
  window.addEventListener('message',event=>{
   if(event.origin!==location.origin)return;
   if(event.source!==engineSource){
    const engine=Array.from(document.querySelectorAll('iframe')).find(frame=>frame.contentWindow===event.source&&new URL(frame.src).pathname.endsWith('/engine/upstream/runtime.html'));
    if(!engine)return;engineSource=event.source;
   }
   record(event.data);
  });
  const launch={mode:0,stage,level:9,stocks:20,minutes:8,ports:[{device:'keyboard',character:lineup==='all-stock'?'vanilla:8':'selected',target:'mario'},{device:'cpu',character:lineup==='custom'?'donaldtrump':'vanilla:2'}, {device:players===4?'cpu':'off',target:!['stock','all-stock'].includes(lineup)?'captain-falcon':'auto',character:lineup==='all-stock'?'vanilla:0':lineup!=='stock'?'abrahamlincoln':'vanilla:9'},{device:players===4?'cpu':'off',target:!['stock','all-stock'].includes(lineup)?'link':'auto',character:lineup==='all-stock'?'vanilla:6':lineup!=='stock'?'barackobama':'vanilla:12'}]};
  if(lineup==='all-stock')launch.ports.forEach((port,index)=>{port.character='vanilla:'+stockCharacters[index];});
  if(caseStudy){launch.ports=[{device:'keyboard',character:'selected',target:'roy'},{device:'cpu',character:'donaldtrump',target:'falco'},{device:'cpu',character:'michelangelo',target:'link'},{device:'off',character:'vanilla:8'}];}
  localStorage.setItem('melee-launch-v1',JSON.stringify(launch));
 },{players,lineup,stage,stockCharacters,caseStudy});
 await page.route('**/api/game{,/**}',route=>{errors.push('Forbidden game request: '+route.request().url());return route.abort();});
 await page.route('**/api/setup{,/**}',route=>{errors.push('Forbidden setup request: '+route.request().url());return route.abort();});
 page.on('request',r=>requests.push({url:r.url(),method:r.method(),bytes:r.postDataBuffer()?.length||0}));
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(process.env.MELEE_TEST_URL||'http://127.0.0.1:5174/?benchmark=1');await page.bringToFront();
  if(process.env.MELEE_CHECK_INVALID){
   const input=page.getByLabel('Choose Melee ISO, GCM or ZIP');
   await input.setInputFiles({name:'short.iso',mimeType:'application/octet-stream',buffer:Buffer.alloc(32)});
   await page.getByRole('alert').filter({hasText:'full, unmodified'}).waitFor();
   const invalid=path.join(output,'invalid.iso'),fd=fs.openSync(invalid,'w'),original=fs.openSync(iso,'r'),header=Buffer.alloc(0x440);
   fs.readSync(original,header,0,header.length,0);fs.closeSync(original);
   fs.writeSync(fd,header);fs.ftruncateSync(fd,1459978240);fs.closeSync(fd);
   try{await input.setInputFiles(invalid);await page.getByRole('alert').filter({hasText:'known USA 1.02 Melee disc hash'}).waitFor({timeout:120000});}
   finally{fs.unlinkSync(invalid);}
  }
  await page.evaluate(()=>{window.testMeleeError='';});
  await page.getByLabel('Choose Melee ISO, GCM or ZIP').setInputFiles(iso);
  await page.waitForFunction(()=>window.testMeleeError||document.querySelector('.boot-disc [role="status"]')?.textContent==='Ready to play.',null,{timeout:120000});
  const bootError=await page.evaluate(()=>window.testMeleeError);if(bootError)throw Error(bootError);
  if(process.env.MELEE_SETUP_ONLY){if(errors.length)throw Error(errors.join('\n'));console.log(process.env.MELEE_CHECK_INVALID?'Invalid disc rejection and valid local disc recovery passed.':'Local disc setup passed.');return;}
  const runStarted=events.length;
  if(cdp){tracing=true;await cdp.send('Tracing.start',{categories:'v8,devtools.timeline,disabled-by-default-v8.cpu_profiler',transferMode:'ReturnAsStream'});}
  await page.getByRole('button',{name:caseStudy? /^Play as Ichiro, .* moveset$/ : /^Play as Alan Turing, .* moveset$/}).click();
  const deadline=Date.now()+Math.max(250000,measuredWindows*31000+120000);let captured=false;
  while(Date.now()<deadline){
   await page.waitForTimeout(1000);
   if(process.env.MELEE_CAPTURE_STARTUP&&samples.length<8)await page.screenshot({path:path.join(output,'startup-'+samples.length+'.png')});
   samples.push(await page.evaluate(()=>({time:Date.now(),visible:document.visibilityState,presentedFrames:window.testPresentedFrames,focused:document.hasFocus(),fps:window.meleePerformance?.fps,audio:window.testAudioContexts.map(c=>({state:c.state,time:c.currentTime}))})));
   const alert=await page.locator('.game-message[role="alert"]').allTextContents();
   if(alert.length)throw Error(alert.join(' '));
   if(events.slice(runStarted).some(e=>e.type==='error'))throw Error(events.slice(runStarted).find(e=>e.type==='error').message);
   const windows=events.filter(e=>e.type==='combat-performance');
   if(!captured&&await page.locator('.fps').textContent()) {
    if(await page.evaluate(()=>typeof document.body.moveBefore==='function'&&(!new URLSearchParams(location.search).get('engine')||new URLSearchParams(location.search).get('engine')==='upstream')&&!new URLSearchParams(location.search).has('presentation'))){
     const direct=await page.evaluate(()=>!!document.querySelector('.game-screen iframe[aria-hidden="true"]'));
     if(!direct)throw Error('Expected live upstream canvas presentation');
     events.push({type:'presentation-validation',direct:true});
    }
    captured=true;await page.getByRole('button',{name:'Enable sound',exact:true}).click();if(!process.env.MELEE_TIMING_ONLY)await page.screenshot({path:path.join(output,'first-playable.png')});}
   if(!captured)await page.getByRole('button',{name:'Confirm · A',exact:true}).click();
   if(captured&&process.env.MELEE_INPUT_ONLY){
    const engine=page.frames().find(frame=>frame.url().includes('/engine/upstream/runtime.html'));
    if(!engine)throw Error('Upstream iframe was not found for keyboard validation');
    for(const [key,index,mask] of [['d',5,0],['j',3,256]]){
     await page.keyboard.down(key);
     try{await engine.waitForFunction(({index,mask})=>{
      const p=Module._direct_input_snapshot()/4,value=HEAPF32[p+index];
      return mask?(value&mask)!==0:value>0;
     },{index,mask},{timeout:5000});}finally{await page.keyboard.up(key);}
     await engine.waitForFunction(({index,mask})=>{
      const p=Module._direct_input_snapshot()/4,value=HEAPF32[p+index];
      return mask?(value&mask)===0:value===0;
     },{index,mask},{timeout:5000});
    }
    events.push({type:'input-validation',keyboardStick:true,keyboardAttack:true,release:true});
    if(errors.length)throw Error(errors.join('\n'));
    console.log('Default launcher keyboard → iframe → native controller checks passed.');return;
   }
      if(cdp?windows.length>=(measuredWindows||1):measuredWindows?windows.length>=measuredWindows:windows.length>=3&&windows.slice(-3).every(passes))break;
  }
  await page.screenshot({path:path.join(output,'combat.png')});
  // Capture portable render-state descriptions after timing, before replay
  // terminates this worker. They contain no game assets or driver binaries.
  const cacheWorker=page.workers().find(w=>w.url().includes('engine-worker'));
  if(cacheWorker) {
   const cache=await cacheWorker.evaluate(()=>Array.from(engine.FS.readFile('/user/Cache/GALE01.uidcache')));
   fs.writeFileSync(path.join(output,'GALE01.uidcache'),Buffer.from(cache));
  }
  const upstreamFrame=page.frames().find(frame=>frame.url().includes('/engine/upstream/runtime.html'));
  if(upstreamFrame&&process.env.MELEE_EXPORT_PIPELINES){
   const files=await upstreamFrame.evaluate(()=>Module.FS.readdir('/cache').filter(n=>n.startsWith('pipeline_cache.db')).map(n=>[n,Array.from(Module.FS.readFile('/cache/'+n))]));
   for(const [name,bytes] of files)fs.writeFileSync(path.join(output,name),Buffer.from(bytes));
  }
  await saveTrace();
  const windows=events.filter(e=>e.type==='combat-performance');
  console.log(JSON.stringify({players,windows,errors},null,2));
  if(cdp)return;
  if(windows.length<(caseStudy?1:3))throw Error('Missing combat windows');
  if(errors.length)throw Error(errors.join('\n'));
  if(process.env.MELEE_LINEUP==='all-stock'&&requests.some(r=>new URL(r.url).pathname.startsWith('/api/prepare/')||new URL(r.url).pathname==='/api/character-select'))throw Error('All-stock run unexpectedly prepared injected assets');
   if(process.env.MELEE_REPLAY){
   const checked=events.filter(e=>e.type==='status'&&e.message==='Checking your game… 4%').length;
   await page.getByRole('button',{name:'Return to roster',exact:true}).click();
   await page.getByRole('button',{name:caseStudy? /^Play as Ichiro, .* moveset$/ : /^Play as Alan Turing, .* moveset$/}).click();
   await page.waitForFunction(()=>!!document.querySelector('.fps')?.textContent,null,{timeout:120000});
   if(events.filter(e=>e.type==='status'&&e.message==='Checking your game… 4%').length!==checked)throw Error('Same immutable File was rehashed');
   await page.screenshot({path:path.join(output,'replay.png')});
  }
  if(measuredWindows&&windows.length<measuredWindows)throw Error('Missing requested combat windows');
  if(!(strictWindows?windows:windows.slice(-3)).every(passes))throw Error('60 FPS gate failed');
  if(caseStudy&&windows.some(w=>w.maxFrameMs>maxCaseFrameMs))throw Error(`Case study still has a frame stall over ${maxCaseFrameMs} ms`);
 }finally{
  try{await saveTrace();}catch(error){console.error(error);}
  fs.writeFileSync(path.join(output,'run.json'),JSON.stringify({players,lineup,caseStudy,maxCaseFrameMs,stage,stockCharacters:lineup==='all-stock'?stockCharacters:null,measuredWindows,strictWindows,chromeArgs},null,2));
  fs.writeFileSync(path.join(output,'events.json'),JSON.stringify(events,null,2));
  fs.writeFileSync(path.join(output,'network.json'),JSON.stringify(requests,null,2));
  fs.writeFileSync(path.join(output,'samples.json'),JSON.stringify(samples,null,2));
  fs.writeFileSync(path.join(output,'errors.json'),JSON.stringify(errors,null,2));
  await context.close();
  if(process.env.MELEE_KEEP_BROWSER_PROFILE!=='1'&&!process.env.MELEE_BROWSER_PROFILE)fs.rmSync(profileDirectory,{recursive:true,force:true});
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
