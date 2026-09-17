import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,rebindButton,gamepadBindings,loadBindings,nativeBindings,saveBindings} from '../web/lib/controls.ts';
test('controller profiles survive browser index changes and stay separate from N64 remapping',()=>{
 const oldWindow=globalThis.window,oldStorage=globalThis.localStorage;
 const saved=new Map();let pads=[{id:'Xbox',index:3,connected:true},{id:'Sony',index:0,connected:true}];
 globalThis.localStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)};
 globalThis.window={openSmashControllerRemap:{rawGamepads:()=>pads}};
 try{
  const original=defaults(),edited=rebindButton(original,'a',2,'Xbox');
  assert.equal(gamepadBindings(edited,'Xbox').a,2);
  assert.equal(gamepadBindings(edited,'Xbox').x,0);
  assert.equal(gamepadBindings(edited,'Sony').a,0);
  assert.equal(original.gamepad.a,0);
  saveBindings(edited);assert.equal(loadBindings(),edited);
  assert.equal(nativeBindings().gamepads.gamepad3.a,2);
  pads=[{id:'Xbox',index:1,connected:true}];
  assert.equal(nativeBindings().gamepads.gamepad1.a,2);
  assert.equal(nativeBindings().gamepads.gamepad3,undefined);
 }finally{globalThis.window=oldWindow;globalThis.localStorage=oldStorage;}
});

test('hidden settings dialogs do not block game input',async()=>{
 const {gameInputBlocked}=await import('../web/lib/controls.ts');
 const previous=globalThis.document;let visible=false;
 globalThis.document={querySelectorAll:()=>[{closest:()=>null,getClientRects:()=>visible?[{}]:[]}]};
 try{assert.equal(gameInputBlocked(),false);visible=true;assert.equal(gameInputBlocked(),true);}
 finally{globalThis.document=previous;}
});

test('mounted dialogs beneath hidden modal pages never force a layout read',async()=>{
 const {gameInputBlocked}=await import('../web/lib/controls.ts');
 const previous=globalThis.document;
 globalThis.document={querySelectorAll:()=>[{closest:()=>({hidden:true}),getClientRects:()=>{throw Error('Unexpected layout read');}}]};
 try{assert.equal(gameInputBlocked(),false);}finally{globalThis.document=previous;}
});

test('browser and shared native packets use the same per-device stick profile',async()=>{
 const {sampleMeleePad,rebindAxes,defaultAxes}=await import('../web/lib/controls.ts');
 const b=rebindAxes(defaults(),{...defaultAxes,x:4,y:5,invertY:true,deadzone:.25},'Adapter');
 const pad={id:'Adapter',connected:true,axes:[0,0,0,0,.6,.8],buttons:[]};
 assert.deepEqual(sampleMeleePad(pad,b).slice(3,7),[60,80,0,0]);
 assert.deepEqual(sampleMeleePad({...pad,id:'Other'},b).slice(3,7),[0,0,0,0]);
 assert.equal(sampleMeleePad({...pad,axes:[0,0,0,0,.2,0]},b)[3],0);
});
