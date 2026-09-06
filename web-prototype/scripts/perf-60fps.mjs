// Run serially, with no compilation alongside the benchmark. The 6x budget
// was established on Apple M5 / headed Chrome / hardware ANGLE Metal.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const output=path.resolve(process.env.PERF_OUTPUT || 'eval/performance/latest-60fps');
const main=[
  {name:'target-idle',players:4,custom:true,rate:6,frames:1800},
  {name:'target-cpu',players:4,custom:true,cpu:true,rate:6,frames:1800},
  {name:'target-vanilla',players:4,rate:6,frames:600},
];
const holdout=[
  {name:'target-holdout-idle',players:4,custom:true,rate:6,frames:600},
  {name:'target-holdout-cpu',players:4,custom:true,cpu:true,rate:6,frames:600},
];
function run(script,args=[],env={}) {
  const result=spawnSync(process.execPath,[path.join(here,script),...args],{stdio:'inherit',env:{...process.env,PERF_OUTPUT:output,...env}});
  if(result.error) throw result.error;
  if(result.status!==0) process.exit(result.status || 1);
}
run('perf-benchmark.mjs',[],{PERF_CASES:JSON.stringify(main),PERF_SLUGS:JSON.stringify(['donaldtrump','50cent','abrahamlincoln','marilynmonroe'])});
run('perf-benchmark.mjs',[],{PERF_CASES:JSON.stringify(holdout),PERF_SLUGS:JSON.stringify(['jonahlomu','tomselleck','antonioinoki','dolphlundgren'])});
run('perf-summarize.mjs',[output]);
run('perf-assert.mjs',[...main,...holdout].map(c=>path.join(output,`${c.name}.json`)));
