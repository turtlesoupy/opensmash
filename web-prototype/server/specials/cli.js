#!/usr/bin/env node
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {rigProfile,hash} from './contract.js';
import {generateSet} from './generate.js';
const [characterFile,outputDir,target='mario',bundlePath]=process.argv.slice(2);
if(!characterFile||!outputDir||!bundlePath) throw new Error('Usage: node server/specials/cli.js character.json NEW_OUTPUT_DIRECTORY rig BUNDLE_FILE');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
if(process.env.SPECIALS_ENV_FILE) {
  const lines=(await readFile(process.env.SPECIALS_ENV_FILE,'utf8')).split('\n');
  for(const line of lines) { const match=line.match(/^([A-Z_][A-Z_0-9]*)=(.*)$/); if(match&&!process.env[match[1]]) process.env[match[1]]=match[2].replace(/^['"]|['"]$/g,''); }
}
await mkdir(outputDir,{recursive:false});
const character={...JSON.parse(await readFile(characterFile,'utf8')),bundleHash:hash(await readFile(bundlePath))};
const profile=await rigProfile(root,target);
await writeFile(path.join(outputDir,'input.json'),JSON.stringify({character,profile},null,2));
try {
 const result=await generateSet({format:process.env.SPECIALS_FORMAT||'rich',character,profile,checkpoint:async(stage,value)=>{
   await writeFile(path.join(outputDir,`${stage}.json`),JSON.stringify(value,null,2),{flag:'wx'});
   console.log(JSON.stringify({stage,hash:hash(value)}));
 }});
 await writeFile(path.join(outputDir,'package.json'),JSON.stringify(result.packet),{flag:'wx'});
 console.log('Compiled all six contexts; run the engine validation suite before equipping.');
} catch(error) {
 await writeFile(path.join(outputDir,'failure.json'),JSON.stringify({error:error.message,judges:0}));
 throw error;
}
