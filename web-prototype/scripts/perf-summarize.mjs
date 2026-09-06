import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const directory = path.resolve(process.argv[2] || 'eval/performance/2026-09-05');
const rows=[];
for(const filename of await readdir(directory)) {
  if(!filename.endsWith('.json') || filename.startsWith('invalid-')) continue;
  const data=JSON.parse(await readFile(path.join(directory,filename),'utf8'));
  if(!data.summary || !data.result) continue;
  const {summary:s,result:r}=data;
  const windows=[];
  let current=null;
  for(const line of s.profile) {
    const start=line.match(/PROF f=(\d+) work=([\d.]+)ms\/frame skin=([\d.]+)ms\/frame .*texhash=([\d.]+)ms/);
    if(start) current={frame:+start[1],workMs:+start[2],skinMs:+start[3],hashMs:+start[4]};
    const dl=line.match(/PROF\s+dl=([\d.]+)ms/);
    if(dl && current) current.dlMs=+dl[1];
    const stages=line.match(/guiStart=([\d.]+) interpStart=([\d.]+) run=([\d.]+) guiEnd=([\d.]+) endFrame=([\d.]+)/);
    if(stages && current) {
      // Include only whole 60-tick profile windows inside the measured range.
      if(current.frame-60>=r.samples[0][1] && current.frame<=r.samples.at(-1)[1]) {
        windows.push({...current,renderMs:+stages[3],guiEndMs:+stages[4],endFrameMs:+stages[5]});
      }
      current=null;
    }
  }
  const means=Object.fromEntries(['workMs','skinMs','hashMs','dlMs','renderMs','guiEndMs','endFrameMs'].map(key=>
    [key,windows.length?windows.reduce((sum,w)=>sum+w[key],0)/windows.length:null]));
  rows.push({name:s.name,fps:s.simFps,p95Ms:s.p95Ms,p99Ms:s.p99Ms,...means,profileFrames:windows.map(w=>w.frame),
    renderer:s.environment.glRenderer,canvas:s.environment.canvas,wasm:data.metadata.engineWasmSha256});
}
await writeFile(path.join(directory,'summary.json'),JSON.stringify(rows,null,2));
for(const r of rows) console.log(`${r.name.padEnd(34)} ${r.fps.toFixed(2).padStart(6)} FPS  p95=${r.p95Ms.toFixed(2)}ms  work=${r.workMs?.toFixed(2)??'—'}ms  render=${r.renderMs?.toFixed(2)??'—'}ms`);
