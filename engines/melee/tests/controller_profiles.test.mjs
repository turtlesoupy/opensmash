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

test('released trigger noise is filtered while light and full shield pressure are preserved',async()=>{
 const {sampleMeleePad,padActions}=await import('../web/lib/controls.ts');
 const b=defaults();
 const pad={id:'Standard controller',mapping:'standard',connected:true,axes:[],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
 for(const value of [0,.01,.05]){
  pad.buttons[6].value=value;pad.buttons[7].value=value;
  assert.deepEqual(sampleMeleePad(pad,b).slice(7),[0,0]);
  assert.equal(padActions(pad,b.gamepad).has('l'),false);
  assert.equal(padActions(pad,b.gamepad).has('r'),false);
 }
 pad.buttons[6].value=.2;pad.buttons[7].value=1;pad.buttons[7].pressed=true;
 const sample=sampleMeleePad(pad,b);
 assert.deepEqual(sample.slice(7),[51,255]);
 assert.equal(sample[2]&0x40,0);assert.equal(sample[2]&0x20,0x20);
 assert.equal(padActions(pad,b.gamepad).has('l'),true);
 assert.equal(padActions(pad,b.gamepad).has('r'),true);
});

test('trigger filtering follows custom bindings and does not suppress digital shield presses',async()=>{
 const {sampleMeleePad,padActions}=await import('../web/lib/controls.ts');
 const b=rebindButton(defaults(),'l',4,'Handheld');
 const pad={id:'Handheld',mapping:'',connected:true,axes:[],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
 pad.buttons[6].value=1; // Old default trigger no longer drives shield.
 assert.equal(sampleMeleePad(pad,b)[7],0);
 pad.buttons[4]={pressed:true,value:0};
 assert.equal(sampleMeleePad(pad,b)[2]&0x40,0x40);
 assert.equal(padActions(pad,gamepadBindings(b,pad.id)).has('l'),true);
 pad.buttons[4]={pressed:false,value:.3};
 assert.equal(sampleMeleePad(pad,b)[7],77);
});

test('trigger packets remain in byte range for invalid browser values',async()=>{
 const {sampleMeleePad}=await import('../web/lib/controls.ts');
 const pad={id:'Adapter',connected:true,axes:[],buttons:[]};
 for(const [value,expected] of [[-1,0],[NaN,0],[Infinity,0],[2,255]]){
  pad.buttons[6]={pressed:false,value};
  assert.deepEqual(sampleMeleePad(pad,defaults()).slice(7),[expected,0]);
 }
});

test('only the browser standard mapping guarantees our default button layout',async()=>{
 const {hasUnmappedLayout}=await import('../web/lib/controls.ts');
 assert.equal(hasUnmappedLayout({mapping:'standard'}),false);
 assert.equal(hasUnmappedLayout({mapping:''}),true);
});

test('trigger deadzone is per controller and shared by gameplay and live highlights',async()=>{
 const {defaultAxes,rebindAxes,gamepadAxes,sampleMeleePad,padActions,resetGamepad}=await import('../web/lib/controls.ts');
 const b=rebindAxes(defaults(),{...defaultAxes,triggerDeadzone:.2},'Handheld');
 const pad={id:'Handheld',connected:true,axes:[],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
 pad.buttons[6].value=.15;
 assert.equal(sampleMeleePad(pad,b)[7],0);
 assert.equal(padActions(pad,b.gamepad,gamepadAxes(b,pad.id)).has('l'),false);
 assert.equal(sampleMeleePad({...pad,id:'Other'},b)[7],38);
 pad.buttons[6].value=.3;
 assert.equal(sampleMeleePad(pad,b)[7],77);
 assert.equal(padActions(pad,b.gamepad,gamepadAxes(b,pad.id)).has('l'),true);
 assert.equal(gamepadAxes(resetGamepad(b,'Handheld'),'Handheld').triggerDeadzone,.05);
 const disabled=rebindAxes(b,{...defaultAxes,triggerDeadzone:0},'Handheld');
 pad.buttons[6].value=.01;
 assert.equal(sampleMeleePad(pad,disabled)[7],3);
});

test('saved trigger deadzones load with validation and old profiles retain the default',async()=>{
 const previous=globalThis.localStorage,previousWindow=globalThis.window;
 const saved={axes:{triggerDeadzone:.12},axisProfiles:{Old:{deadzone:.2},Handheld:{triggerDeadzone:.25},Invalid:{triggerDeadzone:1}}};
 globalThis.window={};
 globalThis.localStorage={getItem:()=>JSON.stringify(saved)};
 try{
  // A fresh module models page reload rather than reading the in-memory cache.
  const {loadBindings,gamepadAxes}=await import('../web/lib/controls.ts?trigger-deadzone-reload');
  const b=loadBindings();
  assert.equal(gamepadAxes(b).triggerDeadzone,.12);
  assert.equal(gamepadAxes(b,'Handheld').triggerDeadzone,.25);
  assert.equal(gamepadAxes(b,'Old').triggerDeadzone,.05);
  assert.equal(gamepadAxes(b,'Invalid').triggerDeadzone,.05);
 }finally{globalThis.localStorage=previous;globalThis.window=previousWindow;}
});
