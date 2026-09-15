// Run against a privately staged local fixture; never contacts the public site.
import http from 'node:http';
import {once} from 'node:events';
import {readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createEmbeddedMeleeHandler} from '../server/embedded.mjs';
const root=path.resolve(process.argv[2]||'build/melee-embedded-smoke');
const manifest=(await readFile(path.join(root,'manifest-key.txt'),'utf8')).trim();
async function instance(name){
 const handler=createEmbeddedMeleeHandler({env:{...process.env,MELEE_LOCAL_ORIGIN:'',MELEE_SERVICE_ORIGIN:'',NODE_ENV:'production',COOKIE_SECRET:'local-smoke-only',MELEE_EMBEDDED:'1',MELEE_OBJECT_ROOT:path.join(root,'objects'),MELEE_INPUT_MANIFEST:manifest,MELEE_WORKSPACE:path.join(root,name)}});
 const server=http.createServer((req,res)=>{if(!handler(req,res,{user:{uid:'smoke-user'}})){res.writeHead(404);res.end();}});server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 async function request(url,options){const response=await fetch(base+'/melee'+url,options);if(!response.ok)throw Error(`${url}: ${response.status} ${await response.text()}`);return response;}
 try{
  const start=performance.now();await request('/engine/opensmash-web-build.json');console.log(name,'startup',Math.round(performance.now()-start),'ms');
  for(const url of ['/engine/opensmash-web.worker.js','/engine/sys-bundle.bin']){const r=await request(url);await r.arrayBuffer();}
  const prepare=performance.now();const costume=await (await request('/api/prepare/donaldtrump?target=falco&color=0&skin=host',{method:'POST'})).json();
  console.log(name,'prepare',Math.round(performance.now()-prepare),'ms');
  const bytes=await (await request(costume.url)).arrayBuffer();assert.ok(bytes.byteLength>10000);
  const selection=await (await request('/api/character-select',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({costumes:[{character:'donaldtrump',target:'falco',color:0,fighter:costume.fighter,filename:costume.filename}]})})).json();
  for(const asset of selection.assets)assert.ok((await (await request(asset.url)).arrayBuffer()).byteLength>100);
  assert.equal((await fetch(base+'/melee/api/game/sys/main.dol')).status,404);
  console.log(name,'costume and selection verified');
 }finally{handler.close();server.close();server.closeAllConnections();}
}
await mkdir(root,{recursive:true});
await instance('instance-one');await instance('instance-two');
