import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || 'playwright');
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage();
 await page.route('http://capture.test/**',r=>r.fulfill({contentType:'text/html',body:'<iframe src="/engine"></iframe>'}));
 await page.goto('http://capture.test/?perf=1');
 await page.evaluate(()=>{const w=document.querySelector('iframe').contentWindow; const canvas=w.document.createElement('canvas');w.Module={calledRun:true,canvas,HEAPU8:new Uint8Array(100),onGameTick(){w.previousTicks=(w.previousTicks||0)+1;}};w.tickTimer=w.setInterval(()=>w.Module.onGameTick(1),16);const old=setTimeout;window.setTimeout=(fn,ms)=>old(fn,ms===30000?150:ms);});
 await page.addScriptTag({content:(await readFile(new URL('../src/performance-capture.js',import.meta.url),'utf8')).replace('export function','function')+'; window.cleanupCapture=installPerformanceCapture();'});
 await page.getByRole('button',{name:'Record 30s performance report'}).click();
 await page.getByRole('button',{name:'Download performance report'}).waitFor();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download performance report'}).click()]);
 const report=JSON.parse(await readFile(await download.path(),'utf8'));
 if(!report.valid || report.ticks.length<2 || !report.raf.length)throw Error('Invalid capture '+JSON.stringify(report));
 const restored=await page.evaluate(()=>{const w=document.querySelector('iframe').contentWindow;const n=w.previousTicks;w.Module.onGameTick(1);cleanupCapture();return w.previousTicks===n+1 && !document.querySelector('button');});
 if(!restored)throw Error('Cleanup failed');
 console.log(JSON.stringify({valid:report.valid,ticks:report.ticks.length,raf:report.raf.length,cleanup:restored}));
}finally{await browser.close();}
