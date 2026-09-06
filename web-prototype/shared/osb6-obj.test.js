import test from "node:test";
import assert from "node:assert/strict";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { ZipReader, BlobReader, TextWriter, Uint8ArrayWriter } from "@zip.js/zip.js";
import { osb6ToObj, objFilename } from "./osb6-obj.js";
import { objBundle } from "./fixtures/obj-bundle.js";
import { objArchive, characterDownload } from "../src/character-download.js";

test("OBJ round-trips through a 3D importer with target, winding, normals and UVs", () => {
  const result=osb6ToObj(objBundle(),{name:"Casey Aylward",fkind:3});
  const imported=new OBJLoader().parse(result.obj), geometry=imported.children[0].geometry;
  assert.deepEqual([...geometry.attributes.position.array],[10,0,0,11,0,0,10,1,0]);
  assert.deepEqual([...geometry.attributes.normal.array],[0,0,1,0,0,1,0,0,1]);
  assert.deepEqual([...geometry.attributes.uv.array],[0,1,1,1,0,0]);
  assert.deepEqual(imported.materialLibraries,["Casey-Aylward.mtl"]);
  assert.equal(new MTLLoader().parse(result.mtl,"").materialsInfo.character.map_kd,"Casey-Aylward.png");
  assert.deepEqual([...result.mesh.rgba],[255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);
});
test("OBJ rejects missing targets, invalid indices, NaNs and crossing payload boundaries", () => {
  assert.throws(()=>osb6ToObj(objBundle(),{fkind:11}),/selected fighter/);
  let b=objBundle();new DataView(b.buffer).setUint16(144,3,true);
  assert.throws(()=>osb6ToObj(b),/triangle index/);
  b=objBundle();new DataView(b.buffer).setFloat32(60,NaN,true);
  assert.throws(()=>osb6ToObj(b),/vertex position/);
  b=objBundle();new DataView(b.buffer).setUint32(44,100,true);
  assert.throws(()=>osb6ToObj(b),/mesh payload/);
  assert.throws(()=>osb6ToObj(new Uint8Array([1,2,3])),/Truncated/);
});
test("ZIP preserves mesh, material and texture with safe filenames", async () => {
  const png=new Uint8Array([137,80,78,71]);
  const file=await objArchive(objBundle(),{name:"../../Person\nmtllib evil",fkind:0},async mesh=>{
    assert.equal(mesh.textureWidth,2);assert.equal(mesh.textureHeight,2);
    return new Blob([png],{type:"image/png"});
  });
  const reader=new ZipReader(new BlobReader(file.blob)),entries=await reader.getEntries();
  assert.equal(file.filename,"Person-mtllib-evil-obj.zip");
  assert.deepEqual(entries.map(e=>e.filename),["Person-mtllib-evil.obj","Person-mtllib-evil.mtl","Person-mtllib-evil.png","README.txt"]);
  assert.match(await entries[0].getData(new TextWriter()),/mtllib Person-mtllib-evil.mtl/);
  assert.deepEqual(await entries[2].getData(new Uint8ArrayWriter()),png);
  await reader.close();assert.equal(objFilename("../../"),"character");
});
test("OSB6 download preserves original bytes and handles HTTP failures", async t => {
  const bytes=objBundle();const mock=t.mock.method(globalThis,"fetch",async()=>new Response(bytes));
  const file=await characterDownload("https://example.test/private.osb6","osb6",{name:"test"});
  assert.equal(file.filename,"test.osb6");assert.deepEqual(new Uint8Array(await file.blob.arrayBuffer()),bytes);
  mock.mock.mockImplementation(async()=>new Response("not found",{status:404}));
  await assert.rejects(characterDownload("https://example.test/private.osb6","obj",{}),/Could not download/);
});
