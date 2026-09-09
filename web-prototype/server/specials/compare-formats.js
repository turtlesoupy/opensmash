#!/usr/bin/env node
// One first-pass sample per cell; never repairs or selects a winner automatically.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createModel,IMPLEMENT} from './generate.js';
import {implementationSchema,compileSet,hash} from './contract.js';
import {reducedSchema,REDUCED_IMPLEMENT,expandReduced} from './reduced.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const output=process.argv[2];if(!output)throw new Error('Pass a new output directory');
if(process.env.SPECIALS_ENV_FILE)for(const line of (await readFile(process.env.SPECIALS_ENV_FILE,'utf8')).split('\n')){
 const m=line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');
}
const fixture=path.join(root,'experiments/special-sets/weird-al-first-run');
const {character,profile}=JSON.parse(await readFile(path.join(fixture,'input.json'),'utf8'));
const {brief}=JSON.parse(await readFile(path.join(fixture,'description.json'),'utf8'));
const bundle=process.env.SPECIALS_COMPARISON_BUNDLE;if(!bundle)throw new Error('SPECIALS_COMPARISON_BUNDLE required');
character.bundleHash=hash(await readFile(bundle));
await mkdir(output,{recursive:false});
const input={character,profile,brief,briefHash:hash(brief)};
await writeFile(path.join(output,'input.json'),JSON.stringify(input,null,2));
const results=[];
for(const model of ['gpt-6-astra','gpt-5.6-luna'])for(const format of ['full','reduced']){
 const name=`${model}-${format}`,dir=path.join(output,name);await mkdir(dir);
 const instructions=format==='full'?IMPLEMENT:REDUCED_IMPLEMENT;
 const schema=format==='full'?implementationSchema:reducedSchema;
 await writeFile(path.join(dir,'request.json'),JSON.stringify({model,format,input,instructions,schema,service_tier:'default'},null,2));
 const start=performance.now();let returnedTier;
 const api=createModel({model,fetchImpl:async(url,options)=>{
  const body=JSON.parse(options.body);body.service_tier='default';
  const response=await fetch(url,{...options,body:JSON.stringify(body)});
  if(response.ok)returnedTier=(await response.clone().json()).service_tier;
  return response;
 }});
 const record={model,format,judges:0,attempts:1,briefHash:hash(brief),status:'failed'};
 try {
  const generated=await api({instructions,input,schema,name:`special_${format}`});
  record.generationMs=Math.round(performance.now()-start);
  record.provenance=generated.provenance;record.serviceTier=returnedTier;
  record.authoringBytes=Buffer.byteLength(JSON.stringify(generated.value));
  await writeFile(path.join(dir,'response.json'),JSON.stringify(generated,null,2));
  const implementation=format==='full'?generated.value:expandReduced({brief,reduced:generated.value});
  await writeFile(path.join(dir,'expanded.json'),JSON.stringify(implementation,null,2));
  const packet=compileSet({brief,implementation,character,profile});
  record.expandedBytes=Buffer.byteLength(JSON.stringify(implementation));
  record.poseKeys=implementation.moves.reduce((s,m)=>s+m.tracks.reduce((n,t)=>n+t.keys.length,0),0);
  record.visualParts=implementation.moves.map(m=>m.parts.length);
  record.status='compiled';
  await writeFile(path.join(dir,'package.json'),JSON.stringify(packet,null,2));
 }catch(error){record.error=error.message;record.generationMs??=Math.round(performance.now()-start);}
 const usage=record.provenance?.usage;
 if(usage){const rate=model==='gpt-6-astra'?[10,1,12.5,50]:[.2,.02,.25,1.2];const cache=usage.input_tokens_details||{};
 record.estimatedUsd=((usage.input_tokens-(cache.cached_tokens||0)-(cache.cache_write_tokens||0))*rate[0]+(cache.cached_tokens||0)*rate[1]+(cache.cache_write_tokens||0)*rate[2]+usage.output_tokens*rate[3])/1e6;}
 results.push(record);await writeFile(path.join(dir,'result.json'),JSON.stringify(record,null,2));
 await writeFile(path.join(output,'results.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify(record));
}
