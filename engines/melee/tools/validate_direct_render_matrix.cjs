/* Exercise real WebGL draws across every selectable stage/fighter. Not a timing benchmark. */
const {chromium}=require('../build/test-tools/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const iso=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]||'engines/melee/build/direct-c/render-matrix');fs.mkdirSync(out,{recursive:true});
 const cases=[...Array.from({length:26},(_,k)=>({name:'fighter-'+k,launch:[0,31,9,20,8,256+k,k===12?264:268,770,777]})),...Array.from({length:31},(_,i)=>i+2).filter(k=>![21,26].includes(k)).map(k=>({name:'stage-'+k,launch:[0,k,9,20,8,264,268,770,777]}))];
 const browser=await chromium.launch({channel:'chrome',headless:false});let results=[];
 const page=await browser.newPage({viewport:{width:1000,height:850}});
 await page.goto('http://127.0.0.1:5188/?fast');await page.locator('#disc').setInputFiles(iso);
 try{for(const c of cases){
  if(process.env.DIRECT_CASE&&!process.env.DIRECT_CASE.split(',').includes(c.name))continue;
  let errors=[];const onError=e=>errors.push(e.message);page.on('pageerror',onError);
  try{
   await page.evaluate(config=>{window.directLaunch=config;window.directArgs=['--no-audio'];},c.launch);
   await page.locator('#start').click();
   await page.waitForFunction(()=>window.directEvents?.some(e=>e.type==='error')||window.directEvents?.some(e=>e.type==='progress'&&e.sceneKind===2&&e.frame>600),null,{timeout:60000});
   const events=await page.evaluate(()=>window.directEvents),rendered=await page.evaluate(()=>window.directRenderedFrames||0);errors.push(...events.filter(e=>e.type==='error').map(e=>e.message));
   if(rendered<60||!events.some(e=>e.type==='playable'))errors.push('Missing rendered, playable match');
   fs.writeFileSync(path.join(out,c.name+'.json'),JSON.stringify({launch:c.launch,rendered,events},null,2));await page.screenshot({path:path.join(out,c.name+'.png')});
  }catch(e){errors.push(String(e));}
  page.off('pageerror',onError);results.push({case:c.name,passed:errors.length===0,errors});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results.at(-1)));
 }}finally{await browser.close()}
 if(!results.length||results.some(r=>!r.passed))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1});
