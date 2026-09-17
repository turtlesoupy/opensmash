/** Validate all target/color outputs through the actual browser worker. */
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=fileURLToPath(new URL('../build/native-fit/',import.meta.url));
await mkdir(base+'roster-validation',{recursive:true});
const targets=JSON.parse(await readFile(new URL('../runtime/retarget-options.json',import.meta.url),'utf8'));
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-unsafe-webgpu']});
const results=[];
try{
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:4174/melee/engine/native-fit/local/manifest.json');
 const character=process.argv[2]||'barackobama';
 const source=await page.evaluate(async character=>{
  const r=await fetch('/melee/api/native-fit/source/'+character,{method:'POST'});const data=await r.json();if(!r.ok)throw Error(data.error);return data;
 },character);
 for(const target of targets)for(let color=0;color<target.costumes.length;color++){
  const result=await page.evaluate(entry=>new Promise((resolve,reject)=>{
   const worker=new Worker('/melee/engine/native-fit/worker.mjs',{type:'module'});
   const timeout=setTimeout(()=>{worker.terminate();reject(Error('Worker timeout'));},30000);
   worker.onerror=e=>{clearTimeout(timeout);worker.terminate();reject(Error(e.message));};
   worker.onmessage=({data})=>{clearTimeout(timeout);worker.terminate();if(data.error){reject(Error(data.error));return;}
    const bytes=new Uint8Array(data.bytes),parts=[];for(let i=0;i<bytes.length;i+=32768)parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));
    resolve({...data,bytes:btoa(parts.join(''))});};
   worker.postMessage(entry);
  }),{character,target:target.slug,color,sourceBase:'/melee'+source.base});
  await writeFile(base+`roster-validation/${character}-${target.slug}-${color}.dat`,Buffer.from(result.bytes,'base64'));
  results.push({...result.metrics,color,filename:result.filename});
  console.log(target.slug,color,'PASS');
 }
 await writeFile(base+'roster-validation/results.json',JSON.stringify(results,null,2));
}finally{await browser.close();}
