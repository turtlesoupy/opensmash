import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {once} from 'node:events';
import {createEmbeddedMeleeHandler} from '../../engines/melee/server/embedded.mjs';

test('embedded gateway starts one child lazily and retains the restricted route boundary',async t=>{
 let calls=0,worker,workerEnv;
 const upstream=http.createServer((req,res)=>{
  assert.equal(req.headers['x-opensmash-token'],workerEnv.MELEE_SERVICE_TOKEN);
  assert.match(req.headers['x-opensmash-owner'],/^[a-f0-9]{64}$/);
  assert.equal(req.headers.authorization,undefined);
  res.end('runtime');
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');t.after(()=>upstream.close());
 const handler=createEmbeddedMeleeHandler({env:{MELEE_EMBEDDED:'1',COOKIE_SECRET:'test-secret',NODE_ENV:'production'},spawnProcess:(cmd,args,options)=>{
  calls++;workerEnv=options.env;worker=new EventEmitter();worker.stdout=new PassThrough();worker.kill=()=>worker.emit('exit',0);
  setImmediate(()=>worker.stdout.write(`MELEE_READY ${upstream.address().port}\n`));return worker;
 }});
 assert.equal(handler({url:'/healthz'},{}),false);assert.equal(calls,0);
 const server=http.createServer((req,res)=>handler(req,res,{user:{uid:'test-user'}}));server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();worker?.kill();});
 const url=`http://127.0.0.1:${server.address().port}`;
 const responses=await Promise.all([fetch(url+'/melee/engine/opensmash-web.js'),fetch(url+'/melee/engine/opensmash-web.wasm')]);
 assert.equal(calls,1);
 for(const r of responses){assert.equal(r.status,200);assert.equal(await r.text(),'runtime');}
 assert.equal((await fetch(url+'/melee/api/game/sys/main.dol')).status,404);
 worker.kill();
 assert.equal((await fetch(url+'/melee/engine/opensmash-web.js')).status,200);assert.equal(calls,2);
});

test('embedded and external configuration cannot accidentally coexist',()=>{
 assert.throws(()=>createEmbeddedMeleeHandler({env:{MELEE_EMBEDDED:'1',MELEE_SERVICE_ORIGIN:'https://example.com'}}),/external/);
 assert.throws(()=>createEmbeddedMeleeHandler({env:{MELEE_EMBEDDED:'1'}}),/COOKIE_SECRET/);
});
