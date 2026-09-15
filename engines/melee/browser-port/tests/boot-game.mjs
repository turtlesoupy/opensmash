// The worker boundary bounds even pure Wasm spins that never call a host import.
import {Worker} from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const worker=new Worker(new URL('./boot-game-worker.mjs',import.meta.url),{argv:process.argv.slice(2)});
const events=[];
worker.on('message',message=>{if(message.event)events.push(message.event);});
const deadline=setTimeout(async()=>{
  await worker.terminate();
  const output=path.join(root,'build/browser-port/game',process.argv.includes('--platform-checks')?'platform-report.json':'boot-report.json');
  fs.writeFileSync(output,JSON.stringify({scope:'bounded native runtime diagnostic',passed:false,events,error:'Worker exceeded 12-second hard deadline'},null,2));
  process.stderr.write('Native runtime diagnostic exceeded its hard deadline\n');process.exitCode=1;
},12000);
worker.on('error',error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
worker.on('exit',code=>{clearTimeout(deadline);if(code)process.exitCode=code;});
