/* Run with Playwright available on NODE_PATH; use a fresh, headed Chrome profile.
 * Usage: node tools/validate_browser_startup.cjs OUTPUT ["Character Name"]
 * No existing browser profile, cookies, or cache is cleared or modified.
 */
const {chromium}=require('playwright');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

(async()=>{
 const output=path.resolve(process.argv[2]||'build/browser-startup-validation');
 const character=process.argv[3]||'Donald Trump';
 fs.mkdirSync(output,{recursive:true});
 const profile=fs.mkdtempSync(path.join(output,'fresh-profile-'));
 const context=await chromium.launchPersistentContext(profile,{
  ...(process.env.CHROME_EXECUTABLE?{executablePath:process.env.CHROME_EXECUTABLE}:{channel:'chrome'}),
  headless:false,viewport:{width:1200,height:900},ignoreDefaultArgs:['--mute-audio']});
 const page=context.pages()[0],results=[],logs=[];
 page.on('console',message=>{if(message.text().includes('[Melee]'))logs.push({time:Date.now(),text:message.text()});});
 const button=new RegExp('^Play as '+character.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+',');
 try {
  for(const name of ['first-visit','repeat-visit']) {
   const entered=Date.now();
   await page.goto('http://127.0.0.1:5174/?disc=server',{waitUntil:'domcontentloaded'});
   if(process.env.OPENSMASH_FOCUS_TEST_WINDOW==='1') {
    const cdp=await context.browser().newBrowserCDPSession();
    const info=await cdp.send('SystemInfo.getProcessInfo');await cdp.detach();
    const pid=info.processInfo.find(p=>p.type==='browser').id;
    const windows=execFileSync('aerospace',['list-windows','--all','--format','%{window-id} %{app-pid}'],{encoding:'utf8'});
    const row=windows.split('\n').map(r=>r.trim().split(/\s+/)).find(r=>Number(r[1])===pid);
    if(row)execFileSync('aerospace',['focus','--window-id',row[0]]);
   }
   await page.bringToFront();
   await page.getByRole('button',{name:button}).click();
   const clicked=Date.now(),samples=[];let firstPlayable;
   for(let second=0;second<75;second++) {
    await page.waitForTimeout(1000);
    const sample=await page.evaluate(()=>({fps:document.querySelector('.fps')?.textContent,visible:document.visibilityState,focused:document.hasFocus(),
      status:document.querySelector('.game-message')?.textContent,
      error:document.querySelector('[role="alert"]')?.textContent,
      timing:window.meleePerformance?{fps:window.meleePerformance.fps,frames:window.meleePerformance.frames}:null}));
    samples.push({elapsedMs:Date.now()-clicked,...sample});
    if(sample.error)throw Error(sample.error);
    if(sample.fps&&!firstPlayable) {
     firstPlayable=Date.now()-clicked;
     await page.screenshot({path:path.join(output,name+'-first-playable.png')});
    }
    if(!firstPlayable)await page.getByRole('button',{name:'Confirm · A',exact:true}).click();
    if(second%15===0)console.log(name,JSON.stringify(samples.at(-1)));
   }
   if(!firstPlayable)throw Error('Match never became playable');
   const worker=page.workers().find(w=>w.url().includes('engine-worker.js'));
   const id=await worker.evaluate(()=>sessionId);
   await page.screenshot({path:path.join(output,name+'.png')});
   results.push({name,character,profile,sessionId:id,pageToClickMs:clicked-entered,firstPlayableMs:firstPlayable,samples});
   fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
   await page.getByRole('button',{name:'Return to roster',exact:true}).click();
  }
 } finally {
  fs.writeFileSync(path.join(output,'console.json'),JSON.stringify(logs,null,2));
  await context.close();
  const trace=path.resolve(__dirname,'../build/moderngekko-validation/browser-trace.jsonl');
  if(fs.existsSync(trace)) {
   const ids=new Set(results.map(r=>r.sessionId));
   const rows=fs.readFileSync(trace,'utf8').trim().split('\n').map(l=>JSON.parse(l)).filter(r=>ids.has(r.sessionId));
   fs.writeFileSync(path.join(output,'trace.json'),JSON.stringify(rows,null,2));
  }
 }
})().catch(error=>{console.error(error);process.exitCode=1;});
