const test=require('node:test'),assert=require('node:assert/strict');
const {parseLaunch}=require('./service.cjs');
test('native launcher accepts only engine URLs and supported option values',()=>{
 assert.equal(parseLaunch('/engine/?SSB64_BOOT_SLOTS=hcco',true).env.SSB64_BOOT_SLOTS,'hcco');
 assert.throws(()=>parseLaunch('/engine/?SSB64_BOOT_SLOTS=xxxx',true));
 assert.equal(parseLaunch('/engine/?SSB64_START_SCENE=16').env.SSB64_START_SCENE,'16');
 for(const url of ['https://other.example/engine/','/api/characters','/engine/?SSB64_START_SCENE=../../file'])assert.throws(()=>parseLaunch(url));
 assert.throws(()=>parseLaunch('/engine/?ports='+encodeURIComponent(JSON.stringify([{kind:'gamepad',index:2},null,null,null]))),/controller assignment/);
});

test('cancelled preparation cannot spawn and failure belongs only to its own session',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
 const {createNativeSsb64}=require('./service.cjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ssb64-lifecycle-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,process.platform==='win32'?'BattleShip.exe':'BattleShip'),'fixture');
 let fetching;const started=new Promise(resolve=>fetching=resolve);let release;const pending=new Promise(resolve=>release=resolve);let spawned=0;
 const service=createNativeSsb64({runtime:dir,workspace:dir,fetchAsset:async()=>{fetching();await pending;return new Response('asset');},spawnProcess:()=>{spawned++;throw Error('spawn failed');}});
 const old='00000000-0000-0000-0000-000000000001',next='00000000-0000-0000-0000-000000000002';
 const launch=service.launch({session:old,src:'/engine/?inject=/asset'});
 await started;await service.stop(old);release();await launch;assert.equal(spawned,0);
 await assert.rejects(service.launch({session:next,src:'/engine/'}),/spawn failed/);
 assert.equal(service.status().session,next);assert.equal(service.status().running,false);
 assert.match(service.status().message,/spawn failed/);
 await service.stop(old);assert.equal(service.status().session,next);
});

test('embedded launch prepares a user ROM before starting a hidden engine and reuses the local archive',async t=>{
 const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events');
 const {createNativeSsb64}=require('./service.cjs');const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ssb64-embedded-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 await fs.writeFile(path.join(dir,'opensmash-runtime.json'),JSON.stringify({launcherInput:1,embeddedFrames:1}));
 await fs.writeFile(path.join(dir,process.platform==='win32'?'BattleShip.exe':'BattleShip'),'engine');await fs.writeFile(path.join(dir,'config.yml'),'recipe');await fs.mkdir(path.join(dir,'yamls'));
 const calls=[];let chosen=0;
 const spawnProcess=(binary,args,options)=>{calls.push({binary,args,options});const child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.kill=()=>{child.exitCode=0;child.emit('close',0);};
  setImmediate(async()=>{if(args[0]==='o2r'){await fs.writeFile(path.join(options.cwd,'BattleShip.o2r'),'archive');child.exitCode=0;child.emit('close',0);}else child.emit('spawn');});return child;};
 const service=createNativeSsb64({runtime:dir,workspace:path.join(dir,'sessions'),inputFile:'input',frameEnvironment:{OPENSMASH_FRAME_FILE:'frames'},chooseRom:async()=>{chosen++;return '/private/game.z64';},spawnProcess});
 await service.launch({session:'00000000-0000-0000-0000-000000000001',src:'/engine/'});assert.equal(chosen,1);assert.equal(calls.length,2);
 assert.equal(calls[0].args[1],'/private/game.z64');assert.equal(calls[1].options.env.OPENSMASH_FRAME_FILE,'frames');assert.equal(service.status().running,true);
 await service.stop();await service.launch({session:'00000000-0000-0000-0000-000000000002',src:'/engine/'});assert.equal(chosen,1);assert.equal(calls.length,3);await service.stop();
});
