import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceExport,sourceManifest,SOURCE_FILES,OPTIONAL_SOURCE_FILES,SOURCE_ASSET_PATH} from './source-export.js';
const job=()=>({id:'test',ownerId:'owner',status:'complete',slug:'example',name:'Example',short:'EXAMPLE',checkpoint:{files:[...SOURCE_FILES,'photo.png','cost.json'].map(name=>({scope:'output',name,key:'private/'+name}))}});
const store={read:async key=>Buffer.from(key)};
test('download route accepts every URL emitted by a complete native source manifest',async()=>{
 const j=job();
 j.checkpoint.files.push(...OPTIONAL_SOURCE_FILES.map(name=>({scope:'output',name,key:'private/'+name})));
 j.sourceExport=await prepareSourceExport(j,'owner',store);
 const manifest=sourceManifest(j);
 const root='/engine/character-source/'+j.sourceExport.capability+'/';
 for(const [name,entry] of Object.entries({...manifest.files,...manifest.nativeSource,'manifest.json':{url:root+'manifest.json'}})){
  const match=entry.url.match(SOURCE_ASSET_PATH);
  assert.ok(match,`Download route must accept ${name}`);
  assert.equal(match[1],j.sourceExport.capability);
  assert.equal(match[2],name);
 }
 assert.equal((root+'nested/rigged.glb').match(SOURCE_ASSET_PATH),null);
});
test('requires the actual owner and complete source assets',async()=>{
 for(const owner of [null,'other'])await assert.rejects(prepareSourceExport(job(),owner,store),/not found/);
 const missing=job();missing.checkpoint.files=[];await assert.rejects(prepareSourceExport(missing,'owner',store),/not available/);
});
test('exports only generated assets, stable digest and no checkpoint paths',async()=>{
 const j=job();j.sourceExport=await prepareSourceExport(j,'owner',store);
 assert.match(j.sourceExport.capability,/^[a-f0-9]{48}$/);
 const again=await prepareSourceExport(j,'owner',store);assert.equal(again.capability,j.sourceExport.capability);
 const m=sourceManifest(j);assert.deepEqual(Object.keys(m.files),SOURCE_FILES);
 assert.equal(m.format,'opensmash-source-v1');assert.ok(!JSON.stringify(m).includes('private/'));assert.ok(!JSON.stringify(m).includes('owner'));
 for(const f of Object.values(m.files)){assert.match(f.sha256,/^[a-f0-9]{64}$/);assert.ok(f.bytes>0);}
});

test('same bytes keep the URL through property reordering and storage relocation',async()=>{
 const j=job();const contentStore={read:async key=>Buffer.from(key.split('/').pop())};
 j.sourceExport=await prepareSourceExport(j,'owner',contentStore);
 const original=j.sourceExport.capability;
 j.sourceExport.files=Object.fromEntries(Object.entries(j.sourceExport.files).reverse().map(([name,f])=>[name,{sha256:f.sha256,bytes:f.bytes,key:f.key}]));
 for(const f of j.checkpoint.files)f.key='relocated/'+f.name;
 const again=await prepareSourceExport(j,'owner',contentStore);
 assert.equal(again.capability,original);
 assert.equal(again.files['rigged.glb'].key,'relocated/rigged.glb');
 const changed=await prepareSourceExport(j,'owner',{read:async key=>Buffer.from(key+'changed')});
 assert.notEqual(changed.capability,original);
});

test('includes optional portable native inputs while keeping legacy sources valid',async()=>{
 const j=job();j.checkpoint.files.push({scope:'output',name:'melee-source.json',key:'private/native-source'});
 j.sourceExport=await prepareSourceExport(j,'owner',store);
 assert.ok(sourceManifest(j).nativeSource['melee-source.json']);
 assert.equal(Object.keys(sourceManifest(j).files).length,SOURCE_FILES.length);
 assert.ok(!sourceManifest(j).files['photo.png']);
});
