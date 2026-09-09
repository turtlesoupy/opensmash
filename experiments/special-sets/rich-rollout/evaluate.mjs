// Produce auditable measurements from retained model outputs and native reports.
// No inference or judging. Run only after both native suites finish.
import fs from 'node:fs/promises';
import path from 'node:path';
import {hash} from '../../../web-prototype/server/specials/contract.js';
import {estimateGenerationUsd} from '../../../web-prototype/server/specials/pricing.js';
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const [output,...directories]=process.argv.slice(2);
if(!output||!directories.length)throw new Error('Usage: evaluate.mjs OUTPUT_JSON RUN_DIRECTORY...');
const characters=[];
for(const directory of directories){
 const input=await read(path.join(directory,'input.json')),description=await read(path.join(directory,'description.json')),built=await read(path.join(directory,'implementation.json')),packet=await read(path.join(directory,'package.json')),native=await read(path.join(directory,'validation/report.json'));
 if(native.status!=='ready'||!native.runtimeValidated)throw new Error(`${directory}: not qualified`);
 if(native.packageFileHash!==hash(await fs.readFile(path.join(directory,'package.json'))))throw new Error('package evidence mismatch');
 const stages=[description.provenance,built.provenance];
 const id=input.character.id.replace(/^prototype-/,'');
 const moves=packet.sets[0].moves.map(m=>({slot:m.slot,context:['Neutral · ground','Up · ground','Down · ground','Neutral · air','Up · air','Down · air'][m.slot],name:m.name,damage:m.hitboxes.reduce((s,h)=>s+h.damage,0),parts:m.parts.length,peakQuads:Math.max(...Array.from({length:m.duration},(_,f)=>m.parts.filter(p=>f>=p.start&&f<p.end).length))}));
 characters.push({id,name:input.character.name,model:stages.map(p=>p.model),outputTokens:stages.reduce((s,p)=>s+p.usage.output_tokens,0),estimatedUsd:stages.reduce((s,p)=>s+estimateGenerationUsd(p),0),authoringBytes:Buffer.byteLength(JSON.stringify(built.implementation)),expandedBytes:Buffer.byteLength(JSON.stringify(packet)),passed:native.contexts.reduce((s,c)=>s+c.scenarios.filter(x=>x.passed).length,0),total:27,moves,packageHash:hash(packet),binaryHash:native.binaryHash,bundleHash:native.bundleHash,descriptionHash:hash(description.brief),scoreHash:hash(built.implementation)});
}
const report={characters,summary:'Two characters, all six contexts each. Every authored hit, native reactions, complete showcases, misses, windup and active interruptions, landing cleanup, and recovery were tested. These are development samples, not a roster-wide reliability or balance benchmark.',productionJudges:0,visualReview:'Development review by the implementing agent; no model judge is part of generation.',firstPassQualification:false,developmentNote:'Final packets recompile unedited recorded outputs after compiler and runtime fixes. Original failed attempts are retained; these are not claimed as fresh first-pass model wins.',pricingSource:'https://developers.openai.com/api/docs/pricing',pricingDate:'2026-09-09',pricingScope:'Displayed writer + implementer calls at standard rates; validation/capture/hosting and failed development attempts excluded.',limitations:['Native samples use the Mario rig; all twelve rigs have compiler coverage.','The bespoke reference and generated scores differ in choreography and art.','Offline prototype worktrees; production worker enablement remains a deployment step.']};
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({characters:characters.map(c=>({name:c.name,passed:c.passed,estimatedUsd:c.estimatedUsd,compression:c.expandedBytes/c.authoringBytes}))}));
