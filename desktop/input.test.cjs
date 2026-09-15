const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createInput}=require('./input.cjs');
test('logical input validates bounds, isolates sessions and changes mute without resetting controls',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'opensmash-input-')),input=createInput(folder);
 t.after(()=>{input.close();fs.rmSync(folder,{recursive:true,force:true});});
 const ports=Array.from({length:4},()=>[3,1,0x100,-80,50,20,-30,128,255]);
 input.begin('first');assert.equal(input.update('first',ports),true);
 let bytes=fs.readFileSync(input.file);assert.equal(bytes.readUInt16LE(10),0x100);assert.equal(bytes.readInt16LE(12),-80);
 input.mute(false);bytes=fs.readFileSync(input.file);assert.equal(bytes[4],0);assert.equal(bytes.readUInt16LE(10),0x100);
 input.begin('second');assert.equal(input.update('first',ports),false);input.stop('first');assert.equal(input.update('second',ports),true);
 const bad=structuredClone(ports);bad[0][2]=Infinity;assert.equal(input.update('second',bad),false);
 input.stop('second');assert.equal(fs.readFileSync(input.file).readUInt16LE(10),0);
});
