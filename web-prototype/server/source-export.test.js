import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSourceExport,sourceManifest,SOURCE_FILES} from './source-export.js';
const job=()=>({id:'test',ownerId:'owner',status:'complete',slug:'example',name:'Example',short:'EXAMPLE',checkpoint:{files:[...SOURCE_FILES,'photo.png','cost.json'].map(name=>({scope:'output',name,key:'private/'+name}))}});
const store={read:async key=>Buffer.from(key)};
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
