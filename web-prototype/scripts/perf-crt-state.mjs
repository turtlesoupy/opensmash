// Browser regression check for compositor state across menu/game transitions.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/perf-crt-state.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const source=await readFile(new URL('../visual/crt-viewport.js',import.meta.url),'utf8');
const browser=await chromium.launch({channel:'chrome',headless:process.env.PERF_HEADLESS==='1'});
try {
  for(const reducedMotion of ['reduce','no-preference']) {
    const context=await browser.newContext({viewport:{width:393,height:851},deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion});
    try {
      const page=await context.newPage();
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{position:fixed;inset:0;width:100%;height:100%}</style><canvas id="crt-viewport-canvas"></canvas>');
      await page.evaluate(()=>{window.draws=0;const draw=WebGLRenderingContext.prototype.drawArrays;WebGLRenderingContext.prototype.drawArrays=function(...args){window.draws++;return draw.apply(this,args)};});
      await page.addScriptTag({content:source});
      await page.waitForFunction(()=>window.draws>0);
      const frames=()=>page.evaluate(()=>new Promise(resolve=>{let n=8;function step(){if(--n)requestAnimationFrame(step);else resolve()}requestAnimationFrame(step)}));
      const filter=()=>page.evaluate(()=>getComputedStyle(window.__crtViewport.canvas).backdropFilter);
      const menuFilter=await filter();
      assert.notEqual(menuFilter,'none');
      await page.evaluate(()=>document.body.classList.add('is-game-running'));
      await frames();
      assert.equal(await filter(),'none',`${reducedMotion}: game must remove backdrop filter`);
      const draws=await page.evaluate(()=>window.draws);
      await frames();
      assert.equal(await page.evaluate(()=>window.draws),draws,'focused overlay must remain static');
      assert.deepEqual(await page.evaluate(()=>[window.__crtViewport.canvas.width,window.__crtViewport.canvas.height]),[393,851],'overlay should not multiply resolution by DPR');
      await page.evaluate(()=>document.body.classList.remove('is-game-running'));
      await frames();
      assert.equal(await filter(),menuFilter,'menu must restore its filter');
      console.log(`PASS ${reducedMotion}: game filter disabled, overlay static at CSS resolution, menu filter restored`);
    } finally {await context.close();}
  }
} finally {await browser.close();}
