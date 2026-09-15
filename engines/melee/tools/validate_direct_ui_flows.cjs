/* Browser launch/results checks; local fixture assets are supplied through the ordinary worker protocol. */
const {chromium}=require('../build/test-tools/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const iso=path.resolve(process.argv[2]),out=path.resolve(process.argv[3]||'engines/melee/build/direct-c/ui-flows');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:false});const results=[];
 try{for(const c of [{name:'custom-results',launch:[0,31,9,1,8,8,258,65800,131336],args:['--no-audio','--kill','1,2,3@900/100000'],query:'?fixture=four&fast',scene:5},{name:'classic',launch:[3,31,9,4,8,8,268,770,777],args:['--no-audio','--autoplay'],query:'?fast',scene:2}]){
  const page=await browser.newPage({viewport:{width:1000,height:850}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.addInitScript(c=>{window.directLaunch=c.launch;window.directArgs=c.args;},c);await page.goto('http://127.0.0.1:5188/'+c.query);await page.locator('#disc').setInputFiles(iso);await page.locator('#start').click();
   await page.waitForFunction(scene=>window.directEvents?.some(e=>e.type==='error')||window.directEvents?.some(e=>e.type==='progress'&&e.sceneKind===scene),c.scene,{timeout:120000});
   if(c.name==='custom-results')await page.waitForFunction(()=>window.directEvents?.some(e=>e.type==='log'&&e.text.includes('results identity port=')),null,{timeout:30000});
   if(c.name==='custom-results')await page.waitForFunction(()=>{const frames=window.directEvents.filter(e=>e.type==='progress'&&e.sceneKind===5);return frames.length>1&&frames.at(-1).frame-frames[0].frame>=480;},null,{timeout:30000});
   else await page.waitForTimeout(1500);
   let events=await page.evaluate(()=>window.directEvents);assert(!events.some(e=>e.type==='error'),JSON.stringify(events.filter(e=>e.type==='error')));assert(await page.evaluate(()=>window.directRenderedFrames>60));await page.screenshot({path:path.join(out,c.name+'.png')});
   if(c.name==='custom-results'){
    assert(events.some(e=>e.type==='log'&&e.text.includes('results identity port=')));
    const before=events.length;
    for(let i=0;i<30;i++){await page.keyboard.down('Enter');await page.waitForTimeout(80);await page.keyboard.up('Enter');await page.keyboard.press('j',{delay:80});await page.waitForTimeout(250);events=await page.evaluate(()=>window.directEvents);if(events.slice(before).some(e=>e.type==='progress'&&e.sceneKind===8))break;}
    assert(events.slice(before).some(e=>e.type==='progress'&&e.sceneKind===8),'Results did not return to character select');await page.screenshot({path:path.join(out,'return-css.png')});
    await page.waitForTimeout(1000);
    const saved=await page.evaluate(()=>new Promise((resolve,reject)=>{const open=indexedDB.open('/saves');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const request=db.transaction('FILE_DATA').objectStore('FILE_DATA').getAllKeys();request.onsuccess=()=>{resolve(request.result);db.close();};request.onerror=()=>reject(request.error);};}));
    assert(saved.some(name=>String(name).endsWith('.sav')),'Game save did not persist to IndexedDB');fs.writeFileSync(path.join(out,'saved-files.json'),JSON.stringify(saved,null,2));
   }
   fs.writeFileSync(path.join(out,c.name+'.json'),JSON.stringify(events,null,2));assert.deepEqual(errors,[]);results.push({case:c.name,passed:true});
  }catch(e){results.push({case:c.name,passed:false,error:String(e)});}finally{await page.close();}console.log(JSON.stringify(results.at(-1)));fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,2));
 }}finally{await browser.close();}
 assert(results.every(r=>r.passed),'Browser flow failed');
})().catch(e=>{console.error(e);process.exitCode=1});
