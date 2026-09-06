import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeCursorGeometry } from '../scripts/lib/cursor-bake.js';

// Captured from the original live cursor before moving its processing offline.
const expected = {
  "position": "08f5a961f9835fcfc60fcced5de2ead3de4e224aa89bb0b3a2c8761cf87fe9e9",
  "normal": "028be152b1048414b39eafeb4a40126329c08910d9c51bece7f8e7d2befc7393",
  "skinIndex": "a4c505a5a75ec616fc719a4cbcac8f2995293f0265ac6d365d8688764ffc6df0",
  "skinWeight": "c98e92cd24b81af6ed975e9d3331bdf779a59362e1cd7e59d53268b2be69c0be",
  "index": "ff7b8a29ab70466f5f34e3e709151d7c3a7133036df0effc717f82aaa69c6767"
};
async function loadMesh(filename) {
  const bytes = await readFile(new URL('../visual/assets/' + filename, import.meta.url));
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  let mesh;
  gltf.scene.traverse(object => { if (object.isMesh && !mesh) mesh = object; });
  assert.ok(mesh, 'cursor asset must contain a mesh');
  return mesh;
}
function verifyLegacyGeometry(geometry) {
  for (const [name, hash] of Object.entries(expected)) {
    const attribute = name === 'index' ? geometry.index : geometry.getAttribute(name);
    const { array } = attribute;
    const actual = createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
    assert.equal(actual, hash, name + ' must match the original cursor');
  }
}
test('baked cursor preserves original geometry, weights and fingertip', async () => {
  const mesh = await loadMesh('hand-cursor-baked.glb');
  verifyLegacyGeometry(mesh.geometry);
  const positions = mesh.geometry.attributes.position;
  const direction = [Math.sin(0.95), Math.cos(0.95)];
  let best = -Infinity, fingertip = -1;
  for (let i = 0; i < positions.count; i++) {
    const score = positions.getX(i) * direction[0] + positions.getY(i) * direction[1];
    if (score > best) { best = score; fingertip = i; }
  }
  assert.equal(mesh.userData.pointerTipIndex, fingertip);
});
test('offline cursor baker reproduces the original runtime output', async () => {
  const mesh = await loadMesh('hand-cursor-meshy.glb');
  verifyLegacyGeometry(bakeCursorGeometry(mesh.geometry));
});
