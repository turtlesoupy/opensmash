import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mergePipelineCaches} from '../runtime/web/shader-warmup.mjs';

const header=[80,85,73,68,8,0,0,0];
const cache=(...records)=>Uint8Array.from([...header,...records.flat()]);
test('upgrades an older seed while retaining locally learned pipelines',()=>{
  const seed=cache([1,2],[3,4]),learned=cache([1,2],[5,6]);
  assert.deepEqual(mergePipelineCaches(seed,learned,2),cache([1,2],[3,4],[5,6]));
  assert.deepEqual(mergePipelineCaches(seed,mergePipelineCaches(seed,learned,2),2),
                   cache([1,2],[3,4],[5,6]));
});
test('replaces incompatible or truncated local caches',()=>{
  const seed=cache([1,2]),wrongVersion=cache([3,4]);wrongVersion[4]=9;
  for(const old of [null,wrongVersion,cache([7]),new Uint8Array(0)])
    assert.deepEqual(mergePipelineCaches(seed,old,2),seed);
  assert.throws(()=>mergePipelineCaches(cache([1]),null,2));
  assert.throws(()=>mergePipelineCaches(seed,null,0));
});
