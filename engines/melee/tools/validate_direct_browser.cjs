const {chromium}=require('../build/test-tools/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
(async()=>{
 const out=path.resolve(process.env.DIRECT_OUTPUT||'engines/melee/build/direct-c/browser-check');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({channel:'chrome',headless:false});const page=await browser.newPage({viewport:{width:1000,height:850}}),logs=[];
 page.on('console',m=>logs.push(m.text()));page.on('pageerror',e=>logs.push(e.stack));
 if(process.env.DIRECT_ARGS)await page.addInitScript(c=>window.directArgs=c,JSON.parse(process.env.DIRECT_ARGS));
 if(process.env.DIRECT_LAUNCH)await page.addInitScript(c=>window.directLaunch=c,JSON.parse(process.env.DIRECT_LAUNCH));console.log('navigate');await page.goto(process.env.DIRECT_URL||'http://127.0.0.1:5188/',{waitUntil:'domcontentloaded'});console.log('disc');await page.locator('#disc').setInputFiles(process.argv[2]);console.log('start');await page.locator('#start').click();console.log('running');
 await page.waitForTimeout(Number(process.env.DIRECT_DURATION||15000));
 console.log('collect');const events=await page.evaluate(()=>window.directEvents||[]);const rendered=await page.evaluate(()=>window.directRenderedFrames||0);console.log({rendered});fs.writeFileSync(path.join(out,'events.json'),JSON.stringify(events,null,2));fs.writeFileSync(path.join(out,'console.log'),logs.join('\n'));await page.screenshot({path:path.join(out,'screen.png')});await browser.close();
 console.log(JSON.stringify({out,events:events.slice(-12),console:logs.slice(-12)},null,2));
 if(events.some(e=>e.type==='error')||rendered<60||!events.some(e=>e.type==='playable')||!events.some(e=>e.type==='progress'&&e.frame>300))process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
