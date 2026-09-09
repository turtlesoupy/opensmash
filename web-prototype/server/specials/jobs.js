import { randomUUID } from 'node:crypto';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateSet,createModel } from './generate.js';
import { hash,rigProfile,SLOTS } from './contract.js';
const exec=promisify(execFile);
const error=(status,message)=>Object.assign(new Error(message),{status});
const terminal=new Set(['complete','failed','cancelled']);
const runtimeReady=report=>report?.status==='ready'&&report.runtimeValidated===true&&report.contexts?.length===6&&
  [0,1,2,3,4,5].every(slot=>report.contexts.filter(c=>(c.slot===slot||c.slot===SLOTS[slot])&&c.passed===true).length===1);
export function publicSpecialJob(job) {
  if(!job)return null;
  return {id:job.id,characterId:job.character.id,status:job.status,stage:job.stage,error:job.error||null,
    target:job.profile.target,createdAt:job.createdAt,updatedAt:job.updatedAt,
    contexts:job.report?.contexts||SLOTS.map(slot=>({slot,passed:false})),judges:0,
    ready:job.status==='complete'&&job.report?.runtimeValidated===true,
    packageHash:job.packageHash||null,description:job.brief||null};
}
export function nativeValidator({engineRoot=process.env.SPECIALS_ENGINE_ROOT}={}) {
 return async ({packet,bundlePath,outputRoot,signal})=>{
  if(!engineRoot) throw new Error('SPECIALS_ENGINE_ROOT must point to a built native validation worker');
  const packagePath=path.join(outputRoot,'package.json');
  await writeFile(packagePath,JSON.stringify({...packet,sets:packet.sets.map(set=>({...set,bundle_path:bundlePath}))}));
  const evidence=path.join(outputRoot,`validation-${randomUUID()}`);
  await exec(process.env.PYTHON||'python3',[path.join(engineRoot,'experiments/custom-attacks/validate_set.py'),
    '--package',packagePath,'--bundle',bundlePath,'--output',evidence,'--capture'],{signal,timeout:30*60*1000,maxBuffer:1024*1024});
  const report=JSON.parse(await readFile(path.join(evidence,'report.json'),'utf8'));
  if(!runtimeReady(report)||report.packageFileHash!==hash(await readFile(packagePath))||report.bundleHash!==hash(await readFile(bundlePath))) throw new Error('Runtime validation did not accept all six contexts');
  return report;
 };
}
export function createSpecialJobs({repoRoot,jobsRoot,jobDatabase,objectStore,dispatcher,
  model=createModel(),validator=nativeValidator(),resolveCharacter}) {
 let queue=Promise.resolve(),reconcileTimer=null;
 const active=new Map();
 // Local API serialization; shared deployments additionally use DB slug reservations and leases.
 let mutations=Promise.resolve();
 const serial=fn=>{const next=mutations.then(fn);mutations=next.catch(()=>{});return next;};
 const dispatch=job=>{
  if(dispatcher.driver==='local') queue=queue.then(()=>runSingle(job.id,`special-${randomUUID()}`)).catch(e=>console.error('Special worker:',e.message));
  else void dispatcher.dispatch(job).catch(async e=>{
    const current=await jobDatabase.get(job.id);
    // Ambiguous worker acceptance must not clobber a lease acquired on the worker.
    if(current?.status==='queued'&&!current.lease?.executionId) await jobDatabase.save({...current,status:'failed',error:e.message});
  });
 };
 async function owned(id,ownerId) {
  const job=await jobDatabase.get(id);
  if(!job||job.ownerId!==ownerId) throw error(404,'Special generation not found');
  return job;
 }
 async function artifact(job,name,value) {
  const key=`specials/${job.id}/${name}-${hash(value)}.json`;
  return objectStore.putJson(key,value,{public:false});
 }
 async function runSingle(id,executionId) {
  if(active.has(id)) return publicSpecialJob(await jobDatabase.get(id));
  const claimed=await jobDatabase.claim(id,executionId,40*60);
  if(!claimed.claimed) return publicSpecialJob(claimed.job);
  const job=claimed.job;
  const controller=new AbortController();active.set(id,controller);
  const save=async()=>{
    job.updatedAt=new Date().toISOString();job.revision=(job.revision||0)+1;
    await jobDatabase.save(job,{executionId});
  };
  let renewed=Date.now();
  const poll=setInterval(async()=>{
    try {
      const stored=await jobDatabase.get(id);
      if(stored?.lease?.executionId!==executionId||stored.status==='cancelled')controller.abort();
      else if(Date.now()-renewed>30000){job.lease.expiresAt=new Date(Date.now()+40*60*1000).toISOString();renewed=Date.now();await save();}
    }
    catch {controller.abort();}
  },2000);poll.unref();
  try {
    job.status='running';job.stage=job.brief?'implementing':'describing';await save();
    const checkpoint=async(stage,value)=>{
      controller.signal.throwIfAborted();
      job.artifacts[stage]=await artifact(job,stage,value);
      (job.history ||= []).push({stage,artifact:job.artifacts[stage],at:new Date().toISOString()});
      if(stage==='description'){job.brief=value.brief;job.stage='implementing';}
      if(stage==='implementation')job.stage='compiling';
      if(stage==='compiled'){job.stage='validating';job.packageHash=value.report.packageHash;}
      await save();
    };
    let result;
    if(job.artifacts.compiled) result=JSON.parse((await objectStore.read(job.artifacts.compiled.key)).toString());
    else {
      const referenceImage=job.portrait ? `data:${job.portrait.contentType||'image/png'};base64,${(await objectStore.read(job.portrait.key,{public:job.portrait.public===true})).toString('base64')}` : null;
      result=await generateSet({character:job.character,profile:job.profile,model,brief:job.brief,referenceImage,checkpoint,signal:controller.signal});
    }
    const outputRoot=path.join(jobsRoot,id);await mkdir(outputRoot,{recursive:true});
    const bundlePath=path.join(outputRoot,'character.osb');
    await writeFile(bundlePath,await objectStore.read(job.bundle.key,{public:job.bundle.public===true}));
    if(hash(await readFile(bundlePath))!==job.character.bundleHash) throw new Error('Character bundle changed after description');
    const report=await validator({packet:result.packet,bundlePath,outputRoot,signal:controller.signal});
    if(!runtimeReady(report)) throw new Error('Incomplete runtime validation');
    controller.signal.throwIfAborted();
    job.artifacts.package=await artifact(job,'package',result.packet);
    for(const context of report.contexts) {
      if(context.preview) {
        const clip=await readFile(context.preview);
        const artifact=await objectStore.putFile(`specials/${job.id}/slot-${context.slot}-${hash(clip)}.mp4`,context.preview,{public:false,contentType:'video/mp4'});
        job.artifacts[`preview-${context.slot}`]=artifact;
        context.preview=`/engine/specials/${job.character.id}/${job.id}/${context.slot}.mp4`;
      }
    }
    job.artifacts.report=await artifact(job,'report',report);
    job.report=report;job.status='complete';job.stage='ready';await save();
  } catch(e) {
    if(e.code!=='LEASE_LOST'&&!controller.signal.aborted) {
      job.status='failed';job.error=e.message;
      try {await save();}catch(saveError){if(saveError.code!=='LEASE_LOST')throw saveError;}
    }
  } finally {clearInterval(poll);active.delete(id);}
  return publicSpecialJob(await jobDatabase.get(id));
 }
 async function reconcile() {
  for(const job of await jobDatabase.list()) {
    if(job.status==='running'&&job.lease?.executionId&&Date.parse(job.lease.expiresAt)<Date.now()) {
      try {await jobDatabase.save({...job,status:'failed',error:'Validation worker expired; retry resumes saved work',lease:null},{executionId:job.lease.executionId,expectedRevision:job.revision});}
      catch(e){if(e.code!=='LEASE_LOST')throw e;}
    }
  }
 }
 return {
  async init({dispatchPending=true}={}) {
    await jobDatabase.init();await mkdir(jobsRoot,{recursive:true});
    if(dispatchPending) for(const job of await jobDatabase.list()) {
      if(job.status==='queued') dispatch(job);

    }
    if(dispatchPending) {
      await reconcile();
      reconcileTimer=setInterval(()=>reconcile().catch(e=>console.error('Special reconciliation:',e.message)),60000);reconcileTimer.unref();
    }
  },
  close(){if(reconcileTimer)clearInterval(reconcileTimer);},
  create(characterId,ownerId,requestId) {return serial(async()=>{
    if(typeof requestId!=='string'||!/^[a-zA-Z0-9-]{8,64}$/.test(requestId))throw error(400,'A stable requestId is required');
    const resolved=await resolveCharacter(characterId,ownerId);
    if(!resolved)throw error(404,'Uploaded character not found');
    const {character,bundle,target,portrait=null}=resolved;
    const profile=await rigProfile(repoRoot,target);
    const id=hash({characterId,ownerId,requestId}).slice(0,40);
    const existing=await jobDatabase.get(id);if(existing)return publicSpecialJob(existing);
    if((await jobDatabase.list()).some(j=>j.ownerId===ownerId&&!terminal.has(j.status))) throw error(409,'A special set is already generating for this account');
    const bytes=await objectStore.read(bundle.key,{public:bundle.public===true});
    const pinnedCharacter={...character,id:characterId,bundleHash:hash(bytes)};
    const now=new Date().toISOString();
    const job={id,slug:id,jobKind:'specials',ownerId,character:pinnedCharacter,bundle,portrait,profile,status:'queued',stage:'queued',revision:1,createdAt:now,updatedAt:now,artifacts:{}};
    try {await jobDatabase.insert(job,{quota:{maxActivePerOwner:1,maxDailyPerOwner:10,maxGlobalActive:8,maxGlobalDaily:100}});}
    catch(e){const concurrent=await jobDatabase.get(id);if(concurrent)return publicSpecialJob(concurrent);throw e;}
    dispatch(job);return publicSpecialJob(job);
  });},
  async latest(characterId,ownerId) {
    return publicSpecialJob((await jobDatabase.list()).filter(j=>j.character.id===characterId&&j.ownerId===ownerId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))[0]);
  },
  async get(id,ownerId){return publicSpecialJob(await owned(id,ownerId));},
  cancel(id,ownerId){return serial(async()=>{
    const job=await owned(id,ownerId);if(terminal.has(job.status))return publicSpecialJob(job);
    job.status='cancelled';job.stage='cancelled';job.lease=null;job.updatedAt=new Date().toISOString();
    await jobDatabase.save(job);active.get(id)?.abort();return publicSpecialJob(job);
  });},
  retry(id,ownerId){return serial(async()=>{
    const job=await owned(id,ownerId);
    if((await jobDatabase.list()).some(j=>j.id!==id&&j.ownerId===ownerId&&!terminal.has(j.status)))throw error(409,'A special set is already generating for this account');
    if(job.status!=='failed')throw error(409,'Only failed sets can be retried');
    if((job.retries||0)>=2)throw error(409,'Retry limit reached');
    job.retries=(job.retries||0)+1;job.status='queued';job.error=null;job.lease=null;
    await jobDatabase.save(job);dispatch(job);return publicSpecialJob(job);
  });},
  async readyPackage(id,characterId) {
    const job=await jobDatabase.get(id);
    if(job?.character.id!==characterId||job.status!=='complete'||!job.report?.runtimeValidated)throw error(404,'Validated special set not found');
    return {job,packet:JSON.parse((await objectStore.read(job.artifacts.package.key)).toString())};
  },
  async preview(id,characterId,slot) {
    const job=await jobDatabase.get(id);
    if(job?.character.id!==characterId||job.status!=='complete')throw error(404,'Preview not found');
    return job.artifacts[`preview-${slot}`]||null;
  },
  runSingle,
  settled:()=>queue,
 };
}
