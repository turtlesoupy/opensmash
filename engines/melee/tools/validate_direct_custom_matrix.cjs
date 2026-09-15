/* Prepare and render a custom character on every currently selectable moveset. */
const {chromium}=require('../build/test-tools/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const schema=require('../runtime/launch-options.json');
(async()=>{
 const iso=path.resolve(process.argv[2]),root=path.resolve(__dirname,'../build/direct-c'),out=path.join(root,'custom-matrix');fs.mkdirSync(out,{recursive:true});const results=[];
 const browser=await chromium.launch({channel:'chrome',headless:false}),page=await browser.newPage({viewport:{width:1000,height:850}});
 await page.goto('http://127.0.0.1:5188/?fast');await page.locator('#disc').setInputFiles(iso);
 const api=async(url,body)=>{const r=await fetch('http://127.0.0.1:5189'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(240000)});const json=await r.json();if(!r.ok)throw Error(JSON.stringify(json));return json;};
 const download=async(url)=>{const r=await fetch('http://127.0.0.1:5189'+url);if(!r.ok)throw Error('Missing asset '+url);return Buffer.from(await r.arrayBuffer());};
 try{for(const target of schema.targets){
  if(process.env.DIRECT_TARGET&&!process.env.DIRECT_TARGET.split(',').includes(target.slug))continue;
  const name='custom-target-'+target.slug,folder=path.join(root,name+'-fixture');fs.mkdirSync(folder,{recursive:true});let errors=[];const error=e=>errors.push(e.message);page.on('pageerror',error);
  try{
   const entries=[{character:'alanturing',target:target.slug,fighter:target.fighter,color:0,filename:schema.costumes[target.fighter][0].filename}];
   const companion=schema.companions?.[target.slug];if(companion)entries.push({character:'alanturing',target:companion.slug,fighter:companion.fighter,color:0,filename:companion.costumes[0].filename,companion:true});
   const files=[];for(const e of entries){const asset=await api('/api/prepare/alanturing?'+new URLSearchParams({target:e.target,color:'0',skin:'host',compact:'1'}));fs.writeFileSync(path.join(folder,e.filename),await download(asset.url));files.push(e.filename);}
   const css=await api('/api/character-select',{costumes:entries});for(const asset of css.assets){const dest=path.join(folder,asset.filename);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,await download(asset.url));files.push(asset.filename);}
   fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(files));
   await page.evaluate(({name,fighter})=>{window.directFixture=name;window.directLaunch=[0,31,9,20,8,256+fighter,fighter===12?264:268,770,777];window.directArgs=['--no-audio'];},{name,fighter:target.fighter});await page.locator('#start').click();
   await page.waitForFunction(()=>window.directEvents?.some(e=>e.type==='error')||window.directEvents?.some(e=>e.type==='progress'&&e.sceneKind===2&&e.frame>1200),null,{timeout:120000});
   const events=await page.evaluate(()=>window.directEvents);errors.push(...events.filter(e=>e.type==='error').map(e=>e.message));assert(events.some(e=>e.type==='playable'));assert(events.some(e=>e.type==='log'&&e.text.includes('stock identity port=0')),'Custom identity was not active');
   await page.screenshot({path:path.join(out,target.slug+'.png')});fs.writeFileSync(path.join(out,target.slug+'.json'),JSON.stringify(events,null,2));
  }catch(e){errors.push(String(e));}finally{await page.evaluate(()=>window.directWorker?.terminate());page.off('pageerror',error);}
  const result={target:target.slug,passed:errors.length===0,errors};results.push(result);console.log(JSON.stringify(result));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,2));
 }}finally{await browser.close();}assert(results.length&&results.every(r=>r.passed),'Custom moveset matrix failed');
})().catch(e=>{console.error(e);process.exitCode=1});
