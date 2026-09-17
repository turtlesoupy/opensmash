import test from 'node:test';
import assert from 'node:assert/strict';
import {meleePath} from '../../engines/melee/web/lib/paths.ts';

test('Melee requests stay namespaced after toggling back to Smash 64', () => {
  const previous = globalThis.location;
  try {
    for (const pathname of ['/melee', '/']) {
      globalThis.location = {pathname};
      assert.equal(meleePath('/api/setup'), '/melee/api/setup');
      assert.equal(meleePath('/engine/upstream/runtime.html'), '/melee/engine/upstream/runtime.html');
      assert.equal(meleePath('/melee/api/setup'), '/melee/api/setup');
    }
  } finally { globalThis.location = previous; }
});

test('hosted engine files retain their versioned URLs', () => {
  const previous = globalThis.window;
  try {
    globalThis.window = {__OPENSMASH_INITIAL_STATE__: {meleeBuild: '0123456789abcdef'}};
    assert.equal(meleePath('/engine/upstream/runtime.html'), '/melee/engine/v/0123456789abcdef/upstream/runtime.html');
    assert.equal(meleePath('/api/setup'), '/melee/api/setup');
  } finally { globalThis.window = previous; }
});
