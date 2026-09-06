import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProgramAsync, compileSceneAsync } from './shader-compilation.js';

function driver({ parallel = true, linked = true, lost = false } = {}) {
  const calls = [];
  let polls = 0;
  const gl = {
    VERTEX_SHADER: 'vertex', FRAGMENT_SHADER: 'fragment', LINK_STATUS: 'link',
    getExtension() { return parallel ? { COMPLETION_STATUS_KHR: 'complete' } : null; },
    createProgram() { return 'program'; },
    createShader(type) { return type; },
    shaderSource() {},
    compileShader(shader) { calls.push(`compile:${shader}`); },
    attachShader() {},
    linkProgram() { calls.push('link'); },
    isContextLost() { return lost; },
    getProgramParameter(program, parameter) {
      calls.push(`query:${parameter}`);
      return parameter === 'complete' ? ++polls === 3 : linked;
    },
    getProgramInfoLog() { calls.push('program-log'); return 'link diagnostic'; },
    getShaderInfoLog(shader) { calls.push(`shader-log:${shader}`); return 'shader diagnostic'; },
    deleteProgram() { calls.push('delete:program'); },
    deleteShader(shader) { calls.push(`delete:${shader}`); },
  };
  return { gl, calls, yieldToBrowser: async () => { calls.push('yield'); } };
}

test('submits compilation together and never asks for blocking results before completion', async () => {
  const { gl, calls, yieldToBrowser } = driver();
  assert.equal(await compileProgramAsync(gl, 'v', 'f', yieldToBrowser), 'program');
  assert.deepEqual(calls, [
    'compile:vertex', 'compile:fragment', 'link',
    'yield', 'query:complete', 'yield', 'query:complete', 'yield', 'query:complete',
    'query:link', 'delete:vertex', 'delete:fragment',
  ]);
});

test('unsupported parallel compilation yields before the required synchronous fallback', async () => {
  const { gl, calls, yieldToBrowser } = driver({ parallel: false });
  await compileProgramAsync(gl, 'v', 'f', yieldToBrowser);
  assert.deepEqual(calls.slice(0, 5), ['compile:vertex', 'compile:fragment', 'link', 'yield', 'query:link']);
});

test('link failure reports diagnostics and frees the program and shaders', async () => {
  const { gl, calls, yieldToBrowser } = driver({ linked: false });
  await assert.rejects(compileProgramAsync(gl, 'v', 'f', yieldToBrowser), /link diagnostic.*\nshader diagnostic/);
  assert.ok(calls.indexOf('program-log') > calls.lastIndexOf('query:complete'));
  assert.deepEqual(calls.slice(-3), ['delete:program', 'delete:vertex', 'delete:fragment']);
});

test('context loss ends polling without querying link status', async () => {
  const { gl, calls, yieldToBrowser } = driver({ lost: true });
  await assert.rejects(compileProgramAsync(gl, 'v', 'f', yieldToBrowser), /context lost/);
  assert.ok(!calls.some(call => call.startsWith('query:')));
  assert.ok(calls.includes('delete:program'));
});

test('Three.js prepares the actual output variant and restores the target while waiting', async () => {
  let target = 'screen', complete;
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: value => { target = value; },
    compileAsync(object, camera, scene) {
      assert.equal(target, 'offscreen');
      assert.deepEqual([object, camera, scene], ['model', 'camera', 'lit scene']);
      return new Promise(resolve => { complete = resolve; });
    },
  };
  const pending = compileSceneAsync(renderer, 'model', 'camera', 'lit scene', 'offscreen');
  assert.equal(target, 'screen', 'must not leave another frame drawing into the temporary target');
  complete('ready');
  assert.equal(await pending, 'ready');
});

test('Three.js submission errors also restore the render target', async () => {
  let target = 'screen';
  const renderer = {
    getRenderTarget: () => target,
    setRenderTarget: value => { target = value; },
    compileAsync() { throw new Error('submission failed'); },
  };
  await assert.rejects(compileSceneAsync(renderer, {}, {}, {}, 'offscreen'), /submission failed/);
  assert.equal(target, 'screen');
});
