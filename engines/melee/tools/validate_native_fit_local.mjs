/** Validate the actual local preparation worker; optionally launch gameplay.
 * Requires serve_melee.py on 8781 and the main shell on 4174. Outputs are ignored.
 * PLAYWRIGHT_MODULE=/path/to/playwright node tools/validate_native_fit_local.mjs [--iso /path/to/game.iso]
 */
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const output=fileURLToPath(new URL('../build/native-fit/local-validation/',import.meta.url));
await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
const results=[];
const characterIndex=process.argv.indexOf('--character');
const selectedCharacter=characterIndex<0?'abrahamlincoln':process.argv[characterIndex+1];
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000}});
 await context.addInitScript(()=>localStorage.setItem('melee-launch-v1',JSON.stringify({stage:31})));
 const page=await context.newPage();
 await page.goto('http://127.0.0.1:4174/melee');
 const schema=JSON.parse(await readFile(new URL('../runtime/launch-options.json',import.meta.url),'utf8'));
 const manifest={characters:[selectedCharacter],targets:schema.targets.map(t=>t.slug)};
 const targetIndex=process.argv.indexOf('--target');
 if(targetIndex>=0){const target=process.argv[targetIndex+1];if(!manifest.targets.includes(target))throw Error('Unknown test target');manifest.targets=[target];}
 if(!process.argv.includes('--game-only'))for(const character of manifest.characters)for(const target of manifest.targets){
  const source=await page.evaluate(async character=>{const r=await fetch('/melee/api/native-fit/source/'+character,{method:'POST'});const data=await r.json();if(!r.ok)throw Error(data.error);return data;},character);
  const result=await page.evaluate(entry=>new Promise((resolve,reject)=>{
   const worker=new Worker('/melee/engine/native-fit/worker.mjs',{type:'module'});
   const timer=setTimeout(()=>{worker.terminate();reject(Error('Worker timeout'));},30000);
   worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(Error(e.message));};
   worker.onmessage=({data})=>{clearTimeout(timer);worker.terminate();if(data.error){reject(Error(data.error));return;}
    const bytes=new Uint8Array(data.bytes),parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
    resolve({...data,bytes:btoa(parts.join(''))});};
   worker.postMessage(entry);
  }),{character,target,color:1,sourceBase:'/melee'+source.base});
  const bytes=Buffer.from(result.bytes,'base64');
  await writeFile(output+character+'-'+target+'.dat',bytes);
  results.push({...result.metrics,filename:result.filename,bytes:bytes.length});
  console.log(JSON.stringify(results.at(-1)));
 }
 const isoIndex=process.argv.indexOf('--iso'),iso=isoIndex<0?null:process.argv[isoIndex+1];
 if(iso){
  for(const target of manifest.targets){
   const requests=[],errors=[],unrelatedErrors=[],logs=[];
   const game=await context.newPage();
   game.on('request',r=>{if(r.url().includes('/api/prepare/'))requests.push(r.url());});
   game.on('pageerror',e=>{
    logs.push('PAGEERROR '+e.stack);
    // Record existing development transport / embedded-trailer errors separately.
    // Neither executes the local fitter or Melee; all other page errors fail.
    if(e.message==='WebSocket closed without opened.'||e.message==='this.api.isExternalMethodAvailable is not a function')unrelatedErrors.push(e.message);
    else errors.push(e.message);
   });game.on('console',m=>logs.push(m.text()));
   await game.goto('http://127.0.0.1:4174/?engine=upstream&benchmark=1'+(process.argv.includes('--defaults')?'':'&moveset='+target));
   await game.getByRole('button',{name:'Play Melee',exact:true}).click();
   if(!game.url().includes('/melee?'))throw Error('Melee toggle lost native test options');
   await game.locator(`[data-roster-character="${selectedCharacter}"]`).first().click();
   if(target===manifest.targets[0]){
    await game.locator('#rom-file-input').setInputFiles(iso);
    await game.locator('#launch-control-skip').click({timeout:60000});
   }else{
    // A fresh page may show the tutorial again after restoring its saved disc.
    await Promise.race([game.locator('#launch-control-skip').click({timeout:30000}).catch(()=>{}),game.waitForFunction(()=>window.meleeNativeFits?.length>0,{},{timeout:30000})]);
   }
   try{
    await game.waitForFunction(()=>window.meleePerformance?.frames>1100||document.querySelector('.game-message[role=alert]'),{},{timeout:60000});
   }catch(error){
    await game.screenshot({path:output+target+'-failed.png'});
    await writeFile(output+target+'-failed.log',logs.join('\n'));
    console.error(await game.locator('.game-message,.melee-setup,#rom-form-error').allTextContents());
    throw error;
   }
   const alerts=await game.locator('.game-message[role=alert]').allTextContents();
   if(requests.length||errors.length||alerts.length)throw Error(JSON.stringify({target,requests,errors,alerts}));
   const metrics=await game.evaluate(()=>({fit:window.meleeNativeFits,frames:window.meleePerformance.frames,fps:window.meleePerformance.fps}));
   if(!logs.some(s=>s.includes('direct skinning vertices=')))throw Error('No custom skinning observed');
   await game.screenshot({path:output+target+'.png'});
   await writeFile(output+target+'.log',logs.join('\n'));
   results.push({gameplay:process.argv.includes('--defaults')?'character-defaults':target,...metrics,prepareRequests:requests.length,unrelatedErrors});
   console.log(JSON.stringify(results.at(-1)));await game.close();
  }
 }
 await writeFile(output+'results.json',JSON.stringify({browser:browser.version(),results},null,2)+'\n');
}finally{await browser.close();}
