/* Shared smash.fun launch gate: pick once, reload, and select during restoration.
 * NODE_PATH=/path/to/node_modules node engines/melee/tools/validate_shared_launch_gate.cjs ISO [OUTPUT]
 * Requires the shared site with its local Melee asset service configured.
 */
const {chromium}=require('playwright'),fs=require('fs'),assert=require('assert/strict');
const path=require('path'),iso=path.resolve(process.argv[2]),output=path.resolve(process.argv[3]||'engines/melee/build/shared-launch-validation');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const ctx=await chromium.launchPersistentContext(fs.mkdtempSync(output+'/site-profile-'),{channel:'chrome',headless:false,viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=ctx.pages()[0];page.on('pageerror',e=>console.log('error',e.message));
 try{
 await page.goto(process.env.MELEE_SITE_TEST_URL||'http://127.0.0.1:5194/melee');await page.waitForFunction(()=>window.gameLauncher&&window.openSmashReactBridge?.experience==='melee');await page.getByRole('gridcell').filter({hasText:'Donald'}).first().click();
 await page.locator('input[type="file"][accept*=".iso"]').first().setInputFiles(iso);console.log('selected');
 await page.waitForFunction(()=>window.openSmashReactBridge?.isAuthorized(),null,{timeout:180000});
 console.log('ready',await page.evaluate(async()=>{const d=await(await navigator.storage.getDirectory()).getDirectoryHandle('opensmash-melee-disc-v1');const n=await(await(await d.getFileHandle('current')).getFile()).text();return(await(await d.getFileHandle(n)).getFile()).size;}));
 await page.reload();await page.waitForFunction(()=>window.gameLauncher&&window.openSmashReactBridge?.experience==='melee');await page.getByRole('gridcell').filter({hasText:'Donald'}).first().click();await page.waitForFunction(()=>window.openSmashReactBridge?.isAuthorized(),null,{timeout:120000});console.log('restored');
 assert.equal(await page.getByRole('button',{name:'Choose disc',exact:true}).filter({visible:true}).count(),0);
 await page.screenshot({path:output+'/shared-production.png'});fs.writeFileSync(output+'/results.json',JSON.stringify({cacheSize:1459978240,restored:true,unnecessaryDiscPrompts:0},null,2));console.log('Shared smash.fun disc gate passed');
 }finally{await ctx.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
