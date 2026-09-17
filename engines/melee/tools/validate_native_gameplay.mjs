/** Launch all movesets in mixed four-player matches through the main shell. */
import {createRequire} from 'node:module';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const iso=process.argv[2];if(!iso)throw Error('Pass the local Melee disc path');
const schema=JSON.parse(await readFile(new URL('../runtime/launch-options.json',import.meta.url),'utf8'));
const targets=schema.targets.map(t=>t.slug).filter(t=>t!=='nana');
const output=fileURLToPath(new URL('../build/native-fit/gameplay-parity/',import.meta.url));await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
const context=await browser.newContext({viewport:{width:1280,height:1000}});const results=[];
try{
 for(let begin=0;begin<targets.length;begin+=4){
  const group=targets.slice(begin,begin+4);while(group.length<4)group.push('mario');
  const page=await context.newPage(),logs=[],errors=[],legacy=[];
  page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>{if(!['WebSocket closed without opened.','this.api.isExternalMethodAvailable is not a function'].includes(e.message))errors.push(e.message);});
  page.on('request',r=>{if(r.url().includes('/api/prepare/'))legacy.push(r.url());});
  const settings={...schema.defaults,stage:31,ports:group.map((target,i)=>({device:i?'cpu':'keyboard',character:['selected','robzombie','mahatmagandhi','abrahamlincoln'][i],target}))};
  await page.addInitScript(settings=>localStorage.setItem('melee-launch-v1',JSON.stringify(settings)),settings);
  await page.goto('http://127.0.0.1:4174/?engine=upstream&benchmark=1');
  await page.getByRole('button',{name:'Play Melee',exact:true}).click();
  await page.locator('[data-roster-character="barackobama"]').first().click();
  if(begin===0){await page.locator('#rom-file-input').setInputFiles(iso);await page.locator('#launch-control-skip').click({timeout:60000});}
  else await Promise.race([page.locator('#launch-control-skip').click({timeout:30000}).catch(()=>{}),page.waitForFunction(()=>window.meleeNativeFits?.length>0,{},{timeout:30000})]);
  try{
   await page.waitForFunction(()=>window.meleePerformance?.frames>1100||document.querySelector('.game-message[role=alert]'),{},{timeout:90000});
   const alerts=await page.locator('.game-message[role=alert]').allTextContents();
   if(alerts.length||errors.length||legacy.length)throw Error(JSON.stringify({alerts,errors,legacy}));
   const metrics=await page.evaluate(()=>({fit:window.meleeNativeFits,performance:window.meleePerformance}));
   for(const target of new Set(group))if(!metrics.fit?.some(f=>f.target===target))throw Error('Missing native target '+target);
   if(group.includes('popo')&&!metrics.fit.some(f=>f.target==='nana'))throw Error('Missing Nana companion');
   if(group.includes('zelda')&&!metrics.fit.some(f=>f.target==='sheik'))throw Error('Missing Sheik transformation');
   if(group.includes('sheik')&&!metrics.fit.some(f=>f.target==='zelda'))throw Error('Missing Zelda transformation');
   if(!logs.some(l=>l.includes('direct skinning vertices=')))throw Error('No custom skinning observed');
   results.push({targets:group,...metrics});console.log(JSON.stringify({targets:group,frames:metrics.performance.frames,fps:metrics.performance.fps,fit:metrics.fit}));
  }finally{
   await page.screenshot({path:output+begin+'.png'});await writeFile(output+begin+'.log',logs.join('\n'));
   await writeFile(output+'results.json',JSON.stringify(results,null,2));await page.close();
  }
 }
}finally{await browser.close();}
