// Host-specific regression gate. Run benchmarks serially on the same machine,
// browser, CPU throttle and assets; this is not an Android device certification.
import {readFile} from 'node:fs/promises';
const files=process.argv.slice(2);
if(!files.length) throw new Error('Usage: node perf-assert.mjs <benchmark.json> [...]');
const minimumFps=Number(process.env.PERF_MIN_FPS || 59);
// A two-frame tail budget is separate from the sustained 60 Hz target.
// Report the tail even on passing runs; 60 average is not a locked 16.7 ms cadence.
const maximumP95=Number(process.env.PERF_MAX_P95_MS || (2000/60));
let failed=false;
for(const file of files) {
  const {metadata:m,summary:s,result:r}=JSON.parse(await readFile(file,'utf8'));
  const problems=[];
  if(!s || !r || !m) throw new Error(`${file}: not a benchmark result`);
  if(s.simFps<minimumFps || s.presentedOpportunitiesFps<minimumFps) problems.push('below frame-rate target');
  if(s.p95Ms>maximumP95) problems.push('p95 frame interval exceeds budget');
  if(!Number.isFinite(s.simFps) || !Number.isFinite(s.presentedOpportunitiesFps) || !Number.isFinite(s.p95Ms)) problems.push('missing timing data');
  if(s.frames<600 || r.samples.length<600) problems.push('requires at least 600 measured frames');
  if(s.errors.length || r.hidden.some(([,hidden])=>hidden) || s.environment.visibility!=='visible') problems.push('invalid/backgrounded run');
  if(s.rate!==6 || m.headless || s.rafHz || s.glDiagnostics || s.cpuProfile) problems.push('requires headed, uninstrumented 6x CPU case');
  if(/SwiftShader|llvmpipe|Software/i.test(s.environment.glRenderer)) problems.push('unexpected software GPU');
  if(s.custom && (r.log.match(/OSB5: skinned mesh attached/g)||[]).length<s.players) problems.push('missing custom fighters');
  console.log(`${problems.length?'FAIL':'PASS'} ${s.name}: ${s.simFps.toFixed(2)} ticks/s, ${s.presentedOpportunitiesFps.toFixed(2)} render opportunities/s, p95 ${s.p95Ms.toFixed(2)} ms${problems.length?' — '+problems.join('; '):''}`);
  failed ||= problems.length>0;
}
process.exitCode=failed?1:0;
