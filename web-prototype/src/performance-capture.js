// Opt-in field measurement: no uploads, no work when ?perf=1 is absent.
export function installPerformanceCapture() {
  if (new URLSearchParams(location.search).get('perf') !== '1') return () => {};
  const button = document.createElement('button');
  button.textContent = 'Record 30s performance report';
  button.style.cssText = 'position:fixed;top:8px;right:8px;max-width:80vw;z-index:2147483647;padding:10px;background:#fff;color:#111;font:14px sans-serif';
  document.body.append(button);
  let cancel = () => {};
  let downloadUrl;
  button.onclick = () => {
    if (downloadUrl) {
      const a = document.createElement('a'); a.href = downloadUrl;
      a.download = 'opensmash-performance.json'; a.click(); return;
    }
    const win = [...document.querySelectorAll('iframe')].map(frame => {
      try { return frame.contentWindow?.Module?.calledRun ? frame.contentWindow : null; } catch { return null; }
    }).find(Boolean);
    if (!win) { button.textContent = 'Start a match, then tap to record'; return; }
    const mod = win.Module;
    const gl = mod.canvas.getContext('webgl2') || mod.canvas.getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const params = new URL(win.location.href).searchParams;
    const report = {schemaVersion:1, date:new Date().toISOString(),
      environment: {userAgent:navigator.userAgent, hardwareConcurrency:navigator.hardwareConcurrency,
        deviceMemoryGiB:navigator.deviceMemory ?? null, viewport:[innerWidth,innerHeight], dpr:devicePixelRatio,
        canvas:[mod.canvas.width,mod.canvas.height], heapBytes:mod.HEAPU8?.length,
        renderer:gl && gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
        glAttributes:gl?.getContextAttributes(), crossOriginIsolated:win.crossOriginIsolated},
      engineAssets:win.performance.getEntriesByType('resource').flatMap(entry=>{
        const url=new URL(entry.name); const name=url.pathname.split('/').pop();
        return ['BattleShip.js','BattleShip.wasm'].includes(name) ? [{name,version:url.searchParams.get('v')}] : [];
      }),
      settings:Object.fromEntries([...params].filter(([key]) => ['SSB64_RENDER_SIZE','SSB64_RAF_PACER','SSB64_BOOT_BATTLE','SSB64_BOOT_SLOTS'].includes(key))),
      customPlayers:params.getAll('inject_player').map(value => {try {const p=JSON.parse(value);return {player:p.player,slug:p.slug};}catch{return null;}}),
      ticks:[], raf:[], visibility:[], longTasks:[], contextLost:[]};
    const readProfile = () => {try {return win.FS.readFile('/libsdl/BattleShip/ssb64.log',{encoding:'utf8'});} catch {return '';}};
    const logStart=readProfile().length;
    const start = win.performance.now();
    const now = () => win.performance.now()-start;
    const visibility = () => report.visibility.push([now(),win.document.visibilityState]);
    const lost = () => report.contextLost.push(now());
    const previous = mod.onGameTick;
    const tick = function(frame) { previous?.call(this,frame); report.ticks.push([now(),frame]); };
    mod.onGameTick = tick;
    let rafId;
    const raf = () => {report.raf.push(now()); rafId=win.requestAnimationFrame(raf);};
    rafId=win.requestAnimationFrame(raf);
    visibility(); win.document.addEventListener('visibilitychange',visibility);
    mod.canvas.addEventListener('webglcontextlost',lost);
    let observer;
    try {observer=new win.PerformanceObserver(list=>{for(const entry of list.getEntries()) report.longTasks.push([entry.startTime-start,entry.duration]);});observer.observe({type:'longtask'});} catch {}
    button.disabled=true; button.textContent='Recording 30s — keep playing';
    const timer=setTimeout(() => {
      report.durationMs=now();
      report.engineProfile=readProfile().slice(logStart).split('\n').filter(line=>line.startsWith('PROF '));
      report.sameEngine=win.Module===mod && [...document.querySelectorAll('iframe')].some(frame=>frame.contentWindow===win);
      report.heapUsedBytes=mod._port_heap_used?.();
      const timestamps=report.ticks.map(([time])=>time);
      report.simFps=timestamps.length>1 ? (timestamps.length-1)*1000/(timestamps.at(-1)-timestamps[0]) : null;
      report.rafFps=report.raf.length*1000/report.durationMs;
      const intervals=timestamps.slice(1).map((time,i)=>time-timestamps[i]).sort((a,b)=>a-b);
      report.p95TickMs=intervals.length ? intervals[Math.floor(intervals.length*.95)] : null;
      report.windows=Array.from({length:Math.floor(report.durationMs/5000)},(_,i)=>({
        startSeconds:i*5,simFps:timestamps.filter(t=>t>=i*5000 && t<(i+1)*5000).length/5,
        rafFps:report.raf.filter(t=>t>=i*5000 && t<(i+1)*5000).length/5}));
      report.valid=report.sameEngine && report.visibility.every(([,state])=>state==='visible') && !report.contextLost.length && timestamps.length>1;
      cancel();
      downloadUrl=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
      button.disabled=false; button.textContent='Download performance report';
    },30000);
    cancel=()=>{clearTimeout(timer);win.cancelAnimationFrame(rafId);observer?.disconnect();
      if(mod.onGameTick===tick)mod.onGameTick=previous;
      win.document.removeEventListener('visibilitychange',visibility);mod.canvas.removeEventListener('webglcontextlost',lost);};
  };
  return () => {cancel();button.remove();if(downloadUrl)URL.revokeObjectURL(downloadUrl);};
}
