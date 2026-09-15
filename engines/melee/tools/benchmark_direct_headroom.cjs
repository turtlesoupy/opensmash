/* Unpaced rendering headroom; deliberately speeds up the game and disables audio. */
const {chromium}=require('../build/test-tools/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
(async()=>{
 const iso=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]||'engines/melee/build/direct-c/headroom');fs.mkdirSync(out,{recursive:true});const results=[];
 const browser=await chromium.launch({channel:'chrome',headless:false});
 const activity=[],poll=()=>activity.push({time:Date.now(),compilers:execFileSync('ps',['-Ao','pid,pcpu,comm'],{encoding:'utf8'}).split('\n').filter(line=>/\/(wasm-opt|wasm-emscripten-finalize|clang|emcc|wasm-ld|em\+\+)/.test(line))});poll();const monitor=setInterval(poll,5000);
 try{for(const c of [{name:'two-stock',launch:[0,31,9,20,8,264,268,770,777],url:'?fast'},{name:'four-custom',launch:[0,31,9,20,8,264,258,65800,131336],url:'?fast&fixture=four'}]){
  const caseStarted=Date.now();const page=await browser.newPage({viewport:{width:1000,height:850}});
  await page.addInitScript(c=>{window.directLaunch=c;window.directArgs=['--no-audio'];},c.launch);await page.goto('http://127.0.0.1:5188/'+c.url);await page.locator('#disc').setInputFiles(iso);await page.locator('#start').click();
  await page.waitForFunction(()=>window.directEvents?.some(e=>e.type==='playable')||window.directEvents?.some(e=>e.type==='error'),null,{timeout:120000});await page.waitForTimeout(5000);
  const start=await page.evaluate(()=>window.directEvents.filter(e=>e.type==='progress'&&e.sceneKind===2).at(-1));assert(start,'No combat');
  await page.waitForTimeout(31000);const events=await page.evaluate(()=>window.directEvents),end=events.filter(e=>e.type==='progress'&&e.sceneKind===2).at(-1);assert(!events.some(e=>e.type==='error'));
  const seconds=(end.receivedAtMs-start.receivedAtMs)/1000,result={case:c.name,compilerContention:activity.some(a=>a.time>=caseStarted&&a.compilers.length>0),launch:c.launch,seconds,simulationFps:(end.frame-start.frame)/seconds,presentedBitmapFps:(end.presentedFrames-start.presentedFrames)/seconds,audio:false,unpaced:true,build:events.find(e=>e.type==='session').build};results.push(result);
  fs.writeFileSync(path.join(out,c.name+'.json'),JSON.stringify(events,null,2));await page.screenshot({path:path.join(out,c.name+'.png')});await page.close();console.log(JSON.stringify(result));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,2));
 }}finally{clearInterval(monitor);fs.writeFileSync(path.join(out,'compiler-activity.json'),JSON.stringify(activity,null,2));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
