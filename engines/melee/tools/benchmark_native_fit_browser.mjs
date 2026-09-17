/** Run full native fitting in Chrome workers; Python is not part of execution. */
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(process.argv[2]||'build/native-fit');
const api=fileURLToPath(new URL('../runtime/fitting/native-fit.mjs',import.meta.url));
const worker=`
import createModule from '/fit.mjs';
import {fitCharacter} from '/native-fit.mjs';
const t=performance.now();const module=await createModule();const initMs=performance.now()-t;
onmessage=async({data})=>{
 try{
  const t=performance.now();const fixture=await(await fetch('/fixtures/'+data.name)).json();const loadMs=performance.now()-t;
  const times=[];let result;
  for(let i=0;i<7;i++){const start=performance.now();result=fitCharacter(module,fixture);times.push(performance.now()-start);}
  let positionError=0,normalError=0,weightError=0;
  for(let i=0;i<result.positions.length;i++){positionError=Math.max(positionError,Math.abs(result.positions[i]-fixture.expectedPositions[i]));normalError=Math.max(normalError,Math.abs(result.normals[i]-fixture.expectedNormals[i]));}
  for(let i=0;i<result.joints.length;i++){if(result.joints[i]!==fixture.expectedJoints[i])throw Error('Joint mapping mismatch');weightError=Math.max(weightError,Math.abs(result.weights[i]-fixture.expectedWeights[i]));}
  if(positionError>1e-6||normalError>1e-6||weightError>1e-7)throw Error('Geometry oracle failed: '+JSON.stringify({positionError,normalError,weightError}));
  if(fixture.mode==='round')for(let hand=0;hand<2;hand++){
   const reference=fixture.referenceHands[hand?'R_Hand':'L_Hand'];
   if(reference){if(result.stats[hand*7+5]>reference.after_inside||result.stats[hand*7+4]<reference.minimum_plane_clearance-1e-5)throw Error('Hand clearance regression');}
  }
  // Boundary checks invoke the same worker API used above.
  let rejected=0;
  for(const bad of [{...fixture,n:0},{...fixture,positions:[NaN]},{...fixture,joints:[-1]},{...fixture,weights:null}]){
   try{fitCharacter(module,bad);}catch{rejected++;}
  }
  if(rejected!==4)throw Error('Invalid fitting input was accepted');
  postMessage({name:data.name,mode:fixture.mode,n:fixture.n,initMs,loadMs,times,positionError,normalError,weightError,stats:result.stats,wasmHeapBytes:module.HEAPU8.byteLength,rejectedInvalidInputs:rejected});
 }catch(error){postMessage({error:error.stack});}
};postMessage({ready:true});`;
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Native fitting benchmark</title>');return;}
  if(pathname==='/worker.mjs'){res.setHeader('Content-Type','text/javascript');res.end(worker);return;}
  const file=pathname==='/native-fit.mjs'?api:path.resolve(root,'.'+decodeURIComponent(pathname));
  if(file!==api&&!file.startsWith(root+path.sep))throw Error('Invalid path');
  res.setHeader('Content-Type',file.endsWith('.wasm')?'application/wasm':file.endsWith('.mjs')?'text/javascript':'application/json');res.end(await readFile(file));
 }catch{res.writeHead(404);res.end();}
});
await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(0,'127.0.0.1',resolve);});
let browser;
try{
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage();
 await page.goto('http://127.0.0.1:'+server.address().port);
 const results=[];
 for(const name of (await readdir(path.join(root,'fixtures'))).filter(n=>n.endsWith('.json')).sort()){
  const result=await page.evaluate(name=>new Promise((resolve,reject)=>{
   const worker=new Worker('/worker.mjs',{type:'module'});const timer=setTimeout(()=>{worker.terminate();reject(Error('Native fit exceeded 30-second budget'));},30000);
   worker.onerror=error=>{clearTimeout(timer);worker.terminate();reject(Error(error.message));};
   worker.onmessage=({data})=>{if(data.ready){worker.postMessage({name});return;}clearTimeout(timer);worker.terminate();data.error?reject(Error(data.error)):resolve(data);};
  }),name);results.push(result);console.log(JSON.stringify(result));
 }
 await writeFile(path.join(root,'browser.json'),JSON.stringify({browser:await browser.version(),description:'Full native solve from decoded source and target assets, 7 fits per fresh worker; times include array validation/copy and output materialization; fixture loading/module init separate',results},null,2)+'\n');
}finally{await browser?.close();server.close();}
