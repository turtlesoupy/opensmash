const fs=require('node:fs/promises'),path=require('node:path');
const {spawn}=require('node:child_process');
const ENV_KEYS=new Set(['SSB64_BOOT_BATTLE','SSB64_BOOT_SLOTS','SSB64_BOOT_HUMANS','SSB64_START_SCENE','SSB64_CPU_LEVEL','SSB64_RENDER_SIZE','SSB64_RAF_PACER']);
function parseLaunch(src,launcherInput=false){
 if(typeof src!=='string'||src.length>65536)throw Error('Invalid Smash 64 launch request.');
 const url=new URL(src,'https://smash.fun');
 if(url.origin!=='https://smash.fun'||url.pathname!=='/engine/')throw Error('Invalid Smash 64 engine URL.');
 const params=url.searchParams,env={};
 for(const [key,max] of [['fkind',11],['player',3]])if(params.has(key)&&(!/^\d+$/.test(params.get(key))||Number(params.get(key))>max))throw Error('Invalid selected fighter or player.');
 for(const key of ENV_KEYS)if(params.has(key)){
  const value=params.get(key);if(!(key==='SSB64_BOOT_SLOTS'?/^[hco]{4}$/:/^[0-9,x-]{1,100}$/).test(value))throw Error('Invalid Smash 64 option: '+key+'.');env[key]=value;
 }
 // Browser indices cannot safely be treated as native SDL device identities.
 // Legacy runtimes cannot accept browser port assignments safely.
 const ports=JSON.parse(params.get('ports')||'[null,null,null,null]');
 if(!Array.isArray(ports)||ports.length!==4)throw Error('Four controller ports are required.');
 if(!launcherInput&&ports.some((p,i)=>p && !['cpu','none','off'].includes(p.kind) && !(i===0&&(p.kind==='keyboard'||(p.kind==='gamepad'&&p.index===0)))))
  throw Error('Custom native Smash 64 controller assignment is not available yet. Use the default player-one device.');
 if(params.has('intro_character'))throw Error('Custom native intro sequences are not available yet.');
 return {params,env};
}
function createNativeSsb64({runtime,workspace,inputFile,frameEnvironment,chooseRom,fetchAsset=fetch,spawnProcess=spawn}){
 let child,active,abort,revision=0,closing=Promise.resolve(),status={running:false,ready:false,message:'Ready to launch Smash 64.'};
 function closeProcess(){
  const previous=child;child=undefined;
  if(previous&&previous.exitCode===null&&previous.signalCode==null){
   closing=Promise.all([closing,new Promise(resolve=>{
    const timer=setTimeout(()=>{previous.kill('SIGKILL');},5000);
    previous.once('close',()=>{clearTimeout(timer);resolve();});previous.kill();
   })]).then(()=>{});
  }
  return closing;
 }
 async function stop(session){
  if(session&&active!==session)return;
  const ticket=++revision;active=undefined;abort?.abort();
  await closeProcess();
  if(ticket===revision)status={running:false,ready:false,message:'Game closed.'};
 }
 async function launch({session,src,soundOn=true}){
  if(typeof session!=='string'||!/^[a-f0-9-]{36}$/.test(session))throw Error('Invalid game session.');
  const {params,env}=parseLaunch(src,Boolean(inputFile));
  const ticket=++revision;abort?.abort();active=session;
  abort=new AbortController();const signal=abort.signal;
  status={session,running:false,ready:false,message:'Preparing Smash 64 characters…'};
  try {
  await closeProcess();
  if(ticket!==revision)return;
  let manifest;
  if(inputFile){
   try{manifest=JSON.parse(await fs.readFile(path.join(runtime,'opensmash-runtime.json'),'utf8'));}catch{}
   if(manifest?.launcherInput!==1)throw Error('Build or install the updated Smash 64 runtime for shared controllers and audio.');
   env.OPENSMASH_LAUNCHER_INPUT=inputFile;
   if(frameEnvironment){if(manifest.embeddedFrames!==1)throw Error('Rebuild the Smash 64 runtime for embedded display.');Object.assign(env,frameEnvironment);}
  }
  const binary=path.resolve(runtime,manifest?.runner||(process.platform==='win32'?'BattleShip.exe':'BattleShip'));
  if(!binary.startsWith(path.resolve(runtime)+path.sep))throw Error('Invalid native runtime path.');
  try{await fs.access(binary);}catch{throw Error('Build or install the native Smash 64 runtime first.');}
  const folder=path.join(workspace,session);await fs.mkdir(folder,{recursive:true});
  const data=path.join(workspace,'data');await fs.mkdir(data,{recursive:true});env.SHIP_HOME=data;env.OPENSMASH_DATA_DIR=data;
  if(ticket!==revision)return;
  status={session,running:false,ready:false,message:'Preparing Smash 64 characters…'};
  async function asset(raw,name){
   if(!raw)return '';
   const url=new URL(raw,'https://smash.fun/engine/');
   if(url.username||url.password||!['https://smash.fun','https://storage.googleapis.com'].includes(url.origin))throw Error('Unsupported character asset origin.');
   const response=await fetchAsset(url.href,{signal,redirect:'error'});
   if(!response.ok)throw Error('Could not download the selected character.');
   const chunks=[];let size=0;const reader=response.body.getReader();
   try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32*1024*1024)throw Error('Character asset exceeds 32 MiB.');chunks.push(Buffer.from(value));}}
   finally{await reader.cancel();}
   const file=path.join(folder,name);await fs.writeFile(file,Buffer.concat(chunks));return file;
  }
  if(params.has('inject')){
   env.SSB64_INJECT_BUNDLE=await asset(params.get('inject'),'selected.osb');
   for(const [key,param,name] of [['SSB64_INJECT_UI','inject_ui','selected.osbui'],['SSB64_INJECT_VOICE','inject_voice','selected.wav']]){
    const file=await asset(params.get(param),name);if(file)env[key]=file;
   }
   env.SSB64_INJECT_FKIND=String(Number(params.get('fkind')||0));env.SSB64_INJECT_PLAYER=String(Number(params.get('player')||0));
   env.SSB64_INJECT_NAME=(params.get('inject_name')||'').slice(0,100);env.SSB64_INJECT_SHORT=(params.get('inject_short')||'').slice(0,20);
  }
  const rows=[],picks=['-','-','-','-'];
  for(const raw of params.getAll('inject_player')){
   const entry=JSON.parse(raw),player=entry.player,fkind=entry.fkind;
   if(!Number.isInteger(player)||player<0||player>3||!Number.isInteger(fkind)||fkind<0||fkind>11||!/^[a-z0-9_-]{1,63}$/.test(entry.slug))throw Error('Invalid opponent.');
   const model=await asset(entry.bundleUrl,`player-${player}.osb`),ui=await asset(entry.uiUrl,`player-${player}.osbui`),voice=await asset(entry.voiceUrl,`player-${player}.wav`);
   const name=String(entry.name||entry.slug).replace(/[|\n\r]/g,' ').slice(0,100),short=String(entry.short||entry.slug).replace(/[^A-Za-z]/g,'').slice(0,10).toUpperCase();
   rows.push([entry.slug,fkind,model,ui,voice,short,fkind,name].join('|'));picks[player]=entry.slug;
  }
  if(rows.length){env.SSB64_ROSTER_FILE=path.join(folder,'roster.txt');await fs.writeFile(env.SSB64_ROSTER_FILE,rows.join('\n')+'\n');env.SSB64_PLAYER_CHARS=picks.join(',');}
  if(signal.aborted||active!==session)return;
  if(!soundOn&&!inputFile)env.SSB64_MUTE='1';
  const clean=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('SSB64_')));
  const workingDirectory=path.resolve(runtime,manifest?.workingDirectory||'.');
  if(workingDirectory!==path.resolve(runtime)&&!workingDirectory.startsWith(path.resolve(runtime)+path.sep))throw Error('Invalid native working directory.');
  if(frameEnvironment){
   const archive=path.join(data,'BattleShip.o2r');
   if(!await fs.stat(archive).then(s=>s.isFile()&&s.size>0).catch(()=>false)){
    status={session,running:false,ready:false,message:'Choose your Smash 64 USA ROM.'};
    const rom=await chooseRom?.();
    if(signal.aborted||ticket!==revision)return;
    if(!rom)throw Error('Choose a Smash 64 USA ROM to play.');
    status={session,running:false,ready:false,message:'Preparing your ROM…'};
    const extraction=path.join(folder,'extract');await fs.mkdir(extraction,{recursive:true});
    await fs.copyFile(path.join(workingDirectory,'config.yml'),path.join(extraction,'config.yml'));
    await fs.cp(path.join(workingDirectory,'yamls'),path.join(extraction,'yamls'),{recursive:true});
    const torch=path.join(path.dirname(binary),process.platform==='win32'?'torch.exe':'torch');
    const log=await fs.open(path.join(folder,'extraction.log'),'a');
    try{await new Promise((resolve,reject)=>{
     if(signal.aborted){resolve();return;}
     const extractor=spawnProcess(torch,['o2r',rom,'-s',extraction,'-d',extraction],{cwd:extraction,stdio:['ignore',log.fd,log.fd],windowsHide:true});child=extractor;
     extractor.once('error',reject);extractor.once('close',code=>code===0?resolve():reject(Error('ROM preparation failed. Use an unmodified Smash 64 USA ROM.')));
    });}finally{await log.close();}
    if(signal.aborted||ticket!==revision)return;
    await fs.rename(path.join(extraction,'BattleShip.o2r'),archive);
   }
  }
  if(signal.aborted||ticket!==revision)return;
  const log=await fs.open(path.join(folder,'native-session.log'),'a');
  try{
   if(signal.aborted||ticket!==revision)return;
   const processChild=spawnProcess(binary,[],{cwd:workingDirectory,env:{...clean,...env},stdio:['ignore',log.fd,log.fd],windowsHide:false});
   child=processChild;
   status={session,running:true,ready:false,message:frameEnvironment?'Smash 64 is running.':'Smash 64 is running in its native window.'};
   processChild.once('spawn',()=>{if(ticket===revision)status={...status,ready:true};});
   processChild.once('error',()=>{if(ticket===revision)status={session,running:false,ready:false,message:'The native engine could not start.'};});
   processChild.once('exit',code=>{if(ticket===revision)status={session,running:false,ready:false,message:code?'The native game stopped unexpectedly.':'Game closed.'};});
  }finally{await log.close();}
  return status;
  } catch(error) {
   if(ticket!==revision||signal.aborted)return;
   status={session,running:false,ready:false,message:error.message};
   throw error;
  }
 }
 return {launch,stop,status:()=>status};
}
module.exports={parseLaunch,createNativeSsb64};
