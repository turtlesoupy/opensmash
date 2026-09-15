/* Focused, headed Chrome validation. Uses an isolated profile and a local test server.
 * NODE_PATH=/path/to/node_modules node engines/melee/tools/validate_browser_launch_prep.cjs ISO [OUTPUT]
 * MELEE_TEST_URL defaults to http://127.0.0.1:5193/ (standalone launcher).
 */
const {chromium}=require('playwright');
const assert=require('assert/strict'),fs=require('fs'),path=require('path');
const output=path.resolve(process.argv[3]||'engines/melee/build/launch-prep-validation');fs.mkdirSync(output,{recursive:true});
const iso=path.resolve(process.argv[2]);const url=process.env.MELEE_TEST_URL||'http://127.0.0.1:5193/';
(async()=>{
 const options={channel:'chrome',headless:false,viewport:{width:390,height:844},hasTouch:true,isMobile:true};
 const profile=fs.mkdtempSync(path.join(output,'profile-'));
 let ctx=await chromium.launchPersistentContext(profile,options),page=ctx.pages()[0];
 const errors=[];const monitor=()=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/setup'))errors.push('Unexpected disc upload');});};monitor();
 try{
 await page.addInitScript(()=>localStorage.setItem('melee-launch-v1',JSON.stringify({mode:0,stage:31,level:5,stocks:4,minutes:8,ports:[{device:'keyboard',character:'vanilla:8',target:'mario'},{device:'cpu',character:'vanilla:2'},{device:'off',character:'vanilla:0'},{device:'off',character:'vanilla:6'}]})));
 await page.goto(url);
 await page.getByLabel('Choose Melee ISO, GCM or ZIP').first().setInputFiles(iso);await page.locator('.boot-disc [role="status"]').filter({hasText:/^Ready to play\.$/}).waitFor({state:'attached',timeout:180000});
 const cacheSize=await page.evaluate(async()=>{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('opensmash-melee-disc-v1');const name=await(await(await d.getFileHandle('current')).getFile()).text();return(await(await d.getFileHandle(name)).getFile()).size;});assert.equal(cacheSize,1459978240);
 await page.reload();await page.locator('.boot-disc [role="status"]').filter({hasText:/^Ready to play\.$/}).waitFor({state:'attached',timeout:180000});
 await ctx.close();ctx=await chromium.launchPersistentContext(profile,options);page=ctx.pages()[0];monitor();await page.goto(url);
 await page.locator('.boot-disc [role="status"]').filter({hasText:/^Ready to play\.$/}).waitFor({state:'attached',timeout:180000});
 console.log('Full ISO cache, reload and browser restart passed without uploading');
 await page.getByRole('button',{name:/^Play as Alan Turing, .* moveset$/}).click();await page.locator('.fps').filter({hasText:/FPS/}).waitFor({timeout:180000});await page.locator('.melee-touch-deck').scrollIntoViewIfNeeded();
 const frame=page.frames().find(f=>f.url().includes('/engine/upstream/runtime.html'));assert(frame);
 await frame.evaluate(()=>{window.capturedPads=[];const original=window.postMessage;window.postMessage=function(message,...rest){if(message?.type==='pad')window.capturedPads.push(message.values);return original.call(this,message,...rest);};});
 await page.evaluate(()=>{window.pointerLog=[];for(const t of ['pointerdown','pointerup','pointercancel','lostpointercapture'])document.addEventListener(t,e=>window.pointerLog.push([t,e.pointerId,e.target.getAttribute('aria-label')]),true);});
 const client=await ctx.newCDPSession(page),points=new Map();
 const center=async sel=>{const b=await page.locator(sel).boundingBox();return{x:b.x+b.width/2,y:b.y+b.height/2};};
 const event=async(type)=>{await client.send('Input.dispatchTouchEvent',{type,touchPoints:[...points].map(([id,p])=>({id,...p,radiusX:5,radiusY:5}))});await page.waitForTimeout(80);};
 const latest=()=>frame.evaluate(()=>window.capturedPads.filter(p=>p[0]===0).at(-1));
 const main=await center('.touch-main'),a=await center('.touch-a'),c=await center('.touch-c');
 points.set(1,main);await event('touchStart');points.set(1,{x:main.x+40,y:main.y});await event('touchMove');
 points.set(2,a);await event('touchStart');points.set(3,{x:c.x,y:c.y-25});await event('touchStart');
 let pad=await latest();console.log('simultaneous move+A+C',pad);assert(pad[1]&0x100);assert((pad[2]&255)>210);assert((pad[2]>>>24)>210);
 await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[{id:2,...a}]});points.delete(2);await page.waitForTimeout(100);pad=await latest();console.log('release',pad,await page.evaluate(()=>window.pointerLog));assert.equal(pad[1]&0x100,0);assert((pad[2]&255)>210);assert((pad[2]>>>24)>210);
 points.clear();await event('touchCancel');pad=await latest();assert.equal(pad[1],0);assert.equal(pad[2],0x80808080);
 points.set(1,a);await event('touchStart');await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.waitForTimeout(100);assert.equal((await latest())[1],0);points.clear();await event('touchCancel');
 for(const [selector,bit,trigger]of[['.touch-b',0x200,0],['.touch-x',0x400,0],['.touch-y',0x800,0],['.touch-z',0x10,0],['.touch-l',0x40,255],['.touch-r',0x20,65280],['.touch-taunt',0x8,0],['.touch-start',0x1000,0]]){
  points.set(1,await center(selector));await event('touchStart');pad=await latest();assert(pad[1]&bit,selector);assert.equal(pad[3],trigger);points.clear();await event('touchEnd');assert.equal((await latest())[1],0);
 }
 console.log('All buttons, taunt, analog shields, release/cancel passed');
 await page.screenshot({path:output+'/portrait-controls.png'});
 await page.setViewportSize({width:320,height:740});await page.locator('.melee-touch-deck').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/small-controls.png'});
 const boxes=await page.locator('.melee-touch-deck button').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label'),x:r.x,y:r.y,w:r.width,h:r.height};}));
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert(!(a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y),`overlap ${a.label} / ${b.label}`);}
 console.log('320px hit targets do not overlap');
 await page.setViewportSize({width:844,height:390});await page.locator('.melee-touch-deck').scrollIntoViewIfNeeded();await page.screenshot({path:output+'/landscape-controls.png'});
 await page.getByRole('button',{name:'Toggle fullscreen',exact:true}).click();await page.waitForFunction(()=>!!document.fullscreenElement);await page.screenshot({path:output+'/fullscreen-controls.png'});await page.evaluate(()=>document.exitFullscreen());
 await page.getByRole('button',{name:'Return to roster',exact:true}).click();
 await page.getByRole('button',{name:'Settings',exact:true}).filter({visible:true}).click();
 await page.getByRole('button',{name:'Game Disc',exact:true}).click();await page.getByRole('button',{name:'Clear disc',exact:true}).click();
 await page.waitForFunction(async()=>{try{await(await navigator.storage.getDirectory()).getDirectoryHandle('opensmash-melee-disc-v1');return false;}catch(e){return e.name==='NotFoundError';}});
 await page.reload();await page.waitForFunction(()=>document.querySelector('.boot-disc')?.textContent.includes('Choose your Melee disc to get started.'));
 assert.deepEqual(errors,[]);console.log('Clear disc persists across reload');
 fs.writeFileSync(output+'/touch-results.json' ,JSON.stringify({passed:true,cacheSize,reloadRestore:true,browserRestartRestore:true,clearDisc:true,noUploads:true,smallViewportHitTargets:boxes},null,2));
 }finally{await ctx.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
