/** Run the same direct-C module without a renderer for bounded boot/state tests. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import createMelee from '../build/direct-c/melee-direct.mjs';
Error.stackTraceLimit=80;
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
if(!args.includes('--iso'))throw Error('Pass --iso PATH to your USA 1.02 disc');
const start=performance.now();
let inputFrame=0;const inputPlan=JSON.parse(process.env.DIRECT_INPUTS||'[]');
const game=await createMelee({noInitialRun:true,print:console.log,printErr:console.error,
 preRun:[m=>{m.FS.mkdir('/host');m.FS.mount(m.FS.filesystems.NODEFS,{root:'/'},'/host');}],
 onFrame(frame){if(game._direct_scene_kind()===2&&game._opensmash_preparation_state()===4){inputFrame++;for(const [start,end,...pad] of inputPlan)if(inputFrame>=start&&inputFrame<=end)game._direct_set_pad(...pad);}if(game._opensmash_preparation_state?.()===2)game._opensmash_finish_preparation();if(game._opensmash_intro_state?.()===1)game._opensmash_finish_intro_preparation();if(frame%300===0)console.log(JSON.stringify({type:'direct-progress',frame,scene:game._direct_scene(),sceneKind:game._direct_scene_kind(),fighters:Array.from(new Float32Array(game.HEAPF32.buffer,game._direct_snapshot(),48)),elapsedMs:performance.now()-start}));},
 onExit(status){console.log(JSON.stringify({type:'direct-exit',status,elapsedMs:performance.now()-start}));},
});
for(const opt of ['--iso','--input','--saves','--mod','--screenshots'])for(let i=0;i<args.length-1;i++)if(args[i]===opt)args[i+1]='/host'+path.resolve(args[i+1]);
if(!args.includes('--saves')){const save=path.join(root,'build/direct-c/saves');fs.mkdirSync(save,{recursive:true});args.push('--saves','/host'+save);}
if(process.env.DIRECT_MATCH){const c=JSON.parse(process.env.DIRECT_MATCH);if(!game._direct_configure(...c))throw Error('Invalid direct match config');}
game.callMain(['--headless',...args]);
