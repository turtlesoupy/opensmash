// Rebuild the cursor's ready-to-animate geometry from the original Meshy asset.
import { readFile, writeFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { bakeCursorGeometry } from './lib/cursor-bake.js';

const source = await readFile(new URL('../visual/assets/hand-cursor-meshy.glb', import.meta.url));
const gltf = await new GLTFLoader().parseAsync(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength), '');
let mesh;
gltf.scene.traverse(object => { if (object.isMesh && !mesh) mesh = object; });
if (!mesh) throw new Error('Source cursor has no mesh');
const geometry = bakeCursorGeometry(mesh.geometry);

// A minimal standard GLB: no textures, materials, or duplicate skeleton. The
// runtime binds these JOINTS/WEIGHTS to the shared animated rig in cursor-rig.js.
const bufferViews = [], accessors = [], chunks = [];
let byteLength = 0;
function attribute(array, itemSize, target) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const view = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
  chunks.push(bytes, Buffer.alloc((4 - bytes.length % 4) % 4));
  byteLength += bytes.length + (4 - bytes.length % 4) % 4;
  const componentType = array instanceof Float32Array ? 5126 : array instanceof Uint32Array ? 5125 : 5123;
  const accessor = { bufferView: view, componentType, count: array.length / itemSize, type: {1:'SCALAR',3:'VEC3',4:'VEC4'}[itemSize] };
  accessors.push(accessor);
  return accessors.length - 1;
}
const attributes = {};
for (const [name, semantic] of Object.entries({position:'POSITION',normal:'NORMAL',skinIndex:'JOINTS_0',skinWeight:'WEIGHTS_0'})) {
  const attr = geometry.getAttribute(name);
  attributes[semantic] = attribute(attr.array, attr.itemSize, 34962);
}
accessors[attributes.POSITION].min = geometry.boundingBox.min.toArray();
accessors[attributes.POSITION].max = geometry.boundingBox.max.toArray();
const indices = attribute(geometry.index.array, 1, 34963);
const document = {
  asset: {version:'2.0', generator:'Smash.fun cursor baker'}, scene:0,
  scenes:[{nodes:[0]}], nodes:[{mesh:0, extras:geometry.userData}],
  meshes:[{primitives:[{attributes,indices}]}],
  buffers:[{byteLength}], bufferViews, accessors,
};
const json = Buffer.from(JSON.stringify(document));
const paddedJson = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
const binary = Buffer.concat(chunks);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67,0); header.writeUInt32LE(2,4);
header.writeUInt32LE(28+paddedJson.length+binary.length,8);
header.writeUInt32LE(paddedJson.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binaryHeader=Buffer.alloc(8);binaryHeader.writeUInt32LE(binary.length);binaryHeader.writeUInt32LE(0x004e4942,4);
const result=Buffer.concat([header,paddedJson,binaryHeader,binary]);
await writeFile(new URL('../visual/assets/hand-cursor-baked.glb',import.meta.url),result);
console.log(`Baked ${geometry.attributes.position.count} vertices, ${result.length} bytes`);
