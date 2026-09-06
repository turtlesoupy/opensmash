// Browser regression check for compositor state across menu/game transitions.
// PLAYWRIGHT_PATH=/path/to/playwright node scripts/perf-crt-state.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_PATH || 'playwright');
const helper=await readFile(new URL('../shared/shader-compilation.js',import.meta.url),'utf8');
const helperUrl='data:text/javascript;base64,'+Buffer.from(helper).toString('base64');
const source=(await readFile(new URL('../visual/crt-viewport.js',import.meta.url),'utf8')).replace("'../shared/shader-compilation.js'",JSON.stringify(helperUrl));
const browser=await chromium.launch({channel:'chrome',headless:process.env.PERF_HEADLESS==='1'});
try {
  for(const reducedMotion of ['reduce','no-preference']) {
    const context=await browser.newContext({viewport:{width:393,height:851},deviceScaleFactor:3,isMobile:true,hasTouch:true,reducedMotion});
    try {
      const page=await context.newPage();
      await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{position:fixed;inset:0;width:100%;height:100%}</style><canvas id="crt-viewport-canvas"></canvas>');
      await page.evaluate(()=>{window.draws=0;const draw=WebGLRenderingContext.prototype.drawArrays;WebGLRenderingContext.prototype.drawArrays=function(...args){window.draws++;return draw.apply(this,args)};});
      await page.evaluate(()=>{
        window.__opensmashCrt='off';window.crtContexts=0;window.earlyLinkQueries=0;
        const getContext=HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext=function(type,...args){
          const gl=getContext.call(this,type,...args);
          if(this.id==='crt-viewport-canvas' && type==='webgl' && gl){
            window.crtContexts++;
            const extension=gl.getExtension('KHR_parallel_shader_compile');
            const get=gl.getProgramParameter.bind(gl);let complete=false;
            gl.getProgramParameter=(program,parameter)=>{
              if(extension && parameter===gl.LINK_STATUS && !complete)window.earlyLinkQueries++;
              const value=get(program,parameter);
              if(extension && parameter===extension.COMPLETION_STATUS_KHR && value)complete=true;
              return value;
            };
          }
          return gl;
        };
      });
      await page.addScriptTag({type:'module',content:source});
      await page.waitForFunction(()=>window.__crtViewport);
      assert.equal(await page.evaluate(()=>window.crtContexts),0,'disabled CRT must not allocate WebGL');
      await page.evaluate(()=>{window.__crtViewport.enabled=true;window.__crtViewport.enabled=false;});
      await page.waitForFunction(()=>window.__crtViewport.canvas.dataset.crtState==='ready');
      assert.equal(await page.evaluate(()=>window.__crtViewport.canvas.hidden),true,'disabled while compiling stays hidden');
      assert.equal(await page.evaluate(()=>window.draws),0,'pending/disabled CRT must not draw');
      assert.equal(await page.evaluate(()=>window.earlyLinkQueries),0,'LINK_STATUS must wait for completion');
      await page.evaluate(()=>{window.__crtViewport.enabled=true;});
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
