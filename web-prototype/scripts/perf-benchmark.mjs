// Local, sequential browser benchmark. See docs/performance-validation-2026-09-06.md.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const workspace = path.resolve(import.meta.dirname, '../../..');
const engine = process.env.PERF_ENGINE_ROOT || path.join(workspace, 'BattleShip/web-dist');
const build = path.resolve(process.env.PERF_BUILD_ROOT || engine);
const output = process.env.PERF_OUTPUT || path.join(workspace, 'pipeline/eval/performance/2026-09-05');
await mkdir(output, { recursive: true });
const archive = path.join(workspace, 'BattleShip/build-us/BattleShip.o2r');
const mime = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.wasm':'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    if (url.pathname === '/manifest.json') {
      const manifest = JSON.parse(await readFile(path.join(engine, 'manifest.json')));
      manifest.files.push({ path:'/BattleShip.o2r', url:'/local-archive.o2r' });
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(manifest));
    }
    const isBuildArtifact = ['/BattleShip.js','/BattleShip.wasm'].includes(url.pathname);
    const filename = url.pathname === '/local-archive.o2r' ? archive
      : isBuildArtifact ? path.join(build,path.basename(url.pathname)) : path.resolve(engine, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (filename !== archive && !isBuildArtifact && !filename.startsWith(engine + path.sep)) { res.writeHead(403); return res.end(); }
    res.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
    res.setHeader('Content-Length', (await stat(filename)).size);
    createReadStream(filename).pipe(res);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
browser = await chromium.launch({ channel:'chrome', headless:process.env.PERF_HEADLESS === '1',
  args:[...JSON.parse(process.env.PERF_CHROME_FLAGS || '[]'),'--autoplay-policy=no-user-gesture-required', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
    ...(process.env.PERF_SOFTWARE_GPU === '1' ? ['--use-gl=angle','--use-angle=swiftshader'] : [])] });
const cases = JSON.parse(process.env.PERF_CASES || '[{"name":"vanilla-2","players":2,"rate":1},{"name":"custom-4","players":4,"custom":true,"rate":1}]');
const slugs = JSON.parse(process.env.PERF_SLUGS || '["donaldtrump","50cent","abrahamlincoln","marilynmonroe"]');
const revisions = Object.fromEntries(['BattleShip', 'pipeline'].map(repo => [repo, execFileSync('git', ['rev-parse','HEAD'], {cwd:path.join(workspace,repo),encoding:'utf8'}).trim()]));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const metadata = { chromeFlags:JSON.parse(process.env.PERF_CHROME_FLAGS || '[]'), revisions, engineRoot:engine, buildRoot:build, engineWasmSha256:sha256(await readFile(path.join(build,'BattleShip.wasm'))),
  scriptSha256:sha256(await readFile(new URL(import.meta.url))),
  assets:await Promise.all(slugs.map(async slug=>({slug,sha256:sha256(await readFile(path.join(engine,'bundles',`${slug}.osb6`)))}))),
  archiveSha256:sha256(await readFile(archive)), browser:browser.version(), date:new Date().toISOString(),
  cpu:execFileSync('sysctl',['-n','machdep.cpu.brand_string'],{encoding:'utf8'}).trim(), headless:process.env.PERF_HEADLESS === '1' };
  for (const spec of cases) {
    console.log(`START ${spec.name}`);
    const context = await browser.newContext({viewport:{width:spec.width || 960,height:spec.height || 720},deviceScaleFactor:spec.dpr || 1,
      isMobile:Boolean(spec.mobile),hasTouch:Boolean(spec.mobile)});
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    if(spec.coldRate) await cdp.send('Emulation.setCPUThrottlingRate',{rate:spec.rate || 1});
    const navigationStart=Date.now();
    if(spec.glDiagnostics) await page.addInitScript(() => {
      window.__glCounts={};
      const names=['drawArrays','drawElements','blitFramebuffer','bufferData','bufferSubData','texImage2D','texSubImage2D','getParameter','readPixels','getError','finish','flush','useProgram','bindTexture'];
      for(const Klass of [window.WebGLRenderingContext,window.WebGL2RenderingContext]) if(Klass) for(const name of names) {
        const original=Klass.prototype[name];if(!original)continue;
        Klass.prototype[name]=function(...args){if(window.__perf?.collect)window.__glCounts[name]=(window.__glCounts[name]||0)+1;return original.apply(this,args);};
      }
    });
    if(spec.rafHz) await page.addInitScript(hz => {
      const native=requestAnimationFrame.bind(window); let next=0,last=-1;
      window.requestAnimationFrame=callback=>native(function deliver(time) {
        if(time===last || time>=next) {last=time;next=time+1000/hz-1;callback(time);}
        else native(deliver);
      });
    },spec.rafHz);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const params = new URLSearchParams({SSB64_BOOT_BATTLE:spec.players === 4 ? '0,0,4,0,0,0' : '0,0,4,0',
      SSB64_BOOT_SLOTS:spec.cpu ? (spec.players === 4 ? 'hccc':'hcoo') : (spec.players === 4 ? 'hhhh':'hhoo'),
      SSB64_VS_INTRO:'0',SSB64_FRAME_PROFILE:'1', ...spec.env });
    if (spec.custom) for(let player=0;player<spec.players;player++) params.append('inject_player',JSON.stringify({player,fkind:0,
      slug:slugs[player], bundleUrl:`/bundles/${slugs[player]}.osb6`}));
    if (spec.lowres !== undefined || spec.renderWidth || spec.cvars) await page.route('**/files/BattleShip.cfg.json*', async route => {
      const config = JSON.parse(await readFile(path.join(engine,'files/BattleShip.cfg.json')));
      if (spec.cvars) config.CVars = {...config.CVars, ...spec.cvars};
      if (spec.lowres !== undefined) config.CVars = {...config.CVars, gLowResModePending:spec.lowres};
      if (spec.renderWidth) config.Window = {...config.Window, Width:spec.renderWidth, Height:spec.renderHeight};
      await route.fulfill({json:config});
    });
    await page.goto(`${origin}/?${params}`,{waitUntil:'load'});
    await page.bringToFront();
    await page.waitForFunction(()=>typeof Module !== 'undefined' && Module.calledRun && typeof FS !== 'undefined',{},{timeout:90000});
    await page.evaluate(({captureTick,captureTicks=[]}) => {
      window.__perf = {ticks:0, samples:[], startupSamples:[], raf:[], presented:[], lastPresented:0, hidden:[], captures:{}};
      // SDL's EGL swap checks isContextLost after the complete frame has been
      // drawn, before yielding to the browser. onGameTick runs after a yield:
      // preserveDrawingBuffer=false may already have cleared the canvas there.
      const wanted=new Set([captureTick,...captureTicks].filter(Number.isFinite));
      if(wanted.size) {
        const gl=Module.canvas.getContext('webgl2');
        const original=gl.isContextLost.bind(gl);
        gl.isContextLost=function() {
          const lost=original(); const p=window.__perf; const frame=p.frame+1;
          if(!lost && wanted.has(frame)) {
            const pixels=new Uint8Array(Module.canvas.width*Module.canvas.height*4);
            gl.readPixels(0,0,Module.canvas.width,Module.canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
            let nonblack=0;
            for(let i=0;i<pixels.length;i+=4) if(pixels[i] || pixels[i+1] || pixels[i+2]) nonblack++;
            if(nonblack<100) throw new Error(`Invalid blank capture at tick ${frame}`);
            p.pendingCapture={frame,data:Module.canvas.toDataURL('image/png'),nonblack};
          }
          return lost;
        };
      }
      Module.onGameTick = frame => { const p=window.__perf; p.ticks++; p.frame=frame; p.startupSamples.push([performance.now(),frame]); if(p.collect) p.samples.push([performance.now(),frame]);
        if(wanted.has(frame)) {
          if(p.pendingCapture?.frame!==frame) throw new Error(`No completed-frame capture for tick ${frame}`);
          if(frame===captureTick)p.capture=p.pendingCapture.data;
          if(captureTicks.includes(frame))p.captures[frame]=p.pendingCapture.data;
          (p.captureEvidence ||= {})[frame]={nonblackPixels:p.pendingCapture.nonblack,point:'EGL swap before browser yield'};
          p.pendingCapture=null;
        }
      };
      const raf = () => { const p=window.__perf; if(p.collect) {p.raf.push(performance.now());if(p.ticks!==p.lastPresented)p.presented.push(performance.now());p.lastPresented=p.ticks;} requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
      document.addEventListener('visibilitychange',()=>window.__perf.hidden.push([performance.now(),document.hidden]));
    },spec);
    await page.waitForFunction(()=>window.__perf.ticks>=240,{},{timeout:90000});
    if(errors.length) throw new Error(`${spec.name}: invalid run: ${errors.join('; ')}`);
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:spec.rate || 1});
    await page.evaluate(()=>{window.__perf.warmStart=window.__perf.ticks;});
    await page.waitForFunction(()=>window.__perf.ticks-window.__perf.warmStart>=120,{},{timeout:90000});
    if(spec.cpuProfile) {await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
    await page.evaluate(()=>{const p=window.__perf;p.start=performance.now();p.startTicks=p.ticks;p.lastPresented=p.ticks;p.collect=true;
      p.logStart=FS.readFile('/libsdl/BattleShip/ssb64.log',{encoding:'utf8'}).length;});
    await page.waitForFunction(n=>window.__perf.ticks-window.__perf.startTicks>=n,spec.frames || 300,{timeout:120000});
    if(spec.cpuProfile) {const {profile}=await cdp.send('Profiler.stop');await writeFile(path.join(output,`${spec.name}.cpuprofile`),JSON.stringify(profile));}
    const result = await page.evaluate(()=>{
      const p=window.__perf;p.collect=false;
      const gl=Module.canvas.getContext('webgl2') || Module.canvas.getContext('webgl');
      const ext=gl.getExtension('WEBGL_debug_renderer_info');
      return { ...p, end:performance.now(), glCounts:window.__glCounts, log:FS.readFile('/libsdl/BattleShip/ssb64.log',{encoding:'utf8'}),
        environment:{userAgent:navigator.userAgent,hardwareConcurrency:navigator.hardwareConcurrency,dpr:devicePixelRatio,visibility:document.visibilityState,
          canvas:[Module.canvas.width,Module.canvas.height],viewport:[innerWidth,innerHeight],
          canvasCss:[Module.canvas.getBoundingClientRect().width,Module.canvas.getBoundingClientRect().height],
          visualViewport:window.visualViewport && {width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale},
          touchPoints:navigator.maxTouchPoints,glRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
          glAttributes:gl.getContextAttributes(),heapBytes:Module.HEAPU8.length,heapUsed:Module._port_heap_used?.()} };
    });
    if(result.environment.visibility !== 'visible' || result.hidden.some(([,hidden])=>hidden)) throw new Error(`${spec.name}: invalid backgrounded run`);
    if(spec.custom && (result.log.match(/OSB5: skinned mesh attached/g)||[]).length < spec.players) throw new Error(`${spec.name}: custom meshes did not all attach`);
    const intervals = result.samples.slice(1).map((s,i)=>s[0]-result.samples[i][0]).sort((a,b)=>a-b);
    const duration = result.samples.at(-1)[0] - result.samples[0][0];
    const summary = { ...spec, navigationToEndMs:Date.now()-navigationStart, simFps:(result.samples.length-1)*1000/duration,
      presentedOpportunitiesFps:result.presented.length*1000/(result.end-result.start),rafFps:result.raf.length*1000/(result.end-result.start),
      medianMs:intervals[Math.floor(intervals.length*.5)],p95Ms:intervals[Math.floor(intervals.length*.95)],p99Ms:intervals[Math.floor(intervals.length*.99)],
      environment:result.environment, errors, glCallsPerTick:result.glCounts && Object.fromEntries(Object.entries(result.glCounts).map(([k,v])=>[k,v/result.samples.length])),
      profile:result.log.slice(result.logStart).split('\n').filter(l=>l.includes('PROF')) };
    await writeFile(path.join(output,`${spec.name}.json`),JSON.stringify({metadata,summary,result},null,2));
    if(spec.captureTick) {
      await page.waitForFunction(()=>Boolean(window.__perf.capture),{},{timeout:90000});
      const data=await page.evaluate(()=>window.__perf.capture);
      await writeFile(path.join(output,`${spec.name}-tick${spec.captureTick}.png`),Buffer.from(data.split(',')[1],'base64'));
    }
    for(const frame of spec.captureTicks || []) {
      await page.waitForFunction(frame=>Boolean(window.__perf.captures[frame]),frame,{timeout:90000});
      const data=await page.evaluate(frame=>window.__perf.captures[frame],frame);
      await writeFile(path.join(output,`${spec.name}-tick${frame}.png`),Buffer.from(data.split(',')[1],'base64'));
    }
    if(spec.captureTick || spec.captureTicks?.length) {
      const evidence=await page.evaluate(()=>window.__perf.captureEvidence);
      await writeFile(path.join(output,`${spec.name}-capture-evidence.json`),JSON.stringify(evidence,null,2));
    }
    if(spec.traceFile) {
      const trace=await page.evaluate(file=>FS.readFile(file,{encoding:'utf8'}),spec.traceFile);
      await writeFile(path.join(output,`${spec.name}.gbi`),trace);
    }
    if(spec.uiSmoke) {
      if(!spec.glDiagnostics) throw new Error('uiSmoke requires glDiagnostics');
      const before=await page.evaluate(()=>({...window.__glCounts}));
      await page.keyboard.press('Escape');
      await page.evaluate(()=>{window.__perf.uiStart=window.__perf.ticks;window.__perf.collect=true;});
      await page.waitForFunction(()=>window.__perf.ticks-window.__perf.uiStart>=12,{},{timeout:30000});
      const ui=await page.evaluate(()=>{
        window.__perf.collect=false;
        return {counts:{...window.__glCounts},glError:Module.canvas.getContext('webgl2').getError()};
      });
      const delta=Object.fromEntries(Object.entries(ui.counts).map(([k,v])=>[k,v-(before[k]||0)]));
      if(!(delta.drawElements>0) || ui.glError!==0) throw new Error(`GUI fallback failed: ${JSON.stringify({delta,...ui})}`);
      await writeFile(path.join(output,`${spec.name}-ui.json`),JSON.stringify({delta,glError:ui.glError},null,2));
      await page.screenshot({path:path.join(output,`${spec.name}-ui.png`)});
      await page.keyboard.press('Escape');
    }
    await page.screenshot({path:path.join(output,`${spec.name}.png`)});
    console.log(JSON.stringify(summary));
    await context.close();
  }
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
