import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('./n64-keyboard-runtime.js',import.meta.url),'utf8');
function runtime(saved = new Map()) {
  const events = new Map();
  const documentEvents = new Map();
  const context = vm.createContext({
    localStorage: {getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},
    addEventListener:(name,fn)=>{const list=events.get(name)||[];list.push(fn);events.set(name,list);},
    document:{hidden:false,addEventListener:(name,fn)=>documentEvents.set(name,fn)},
  });
  vm.runInContext(source,context);
  return {api:context.openSmashN64Keyboard,context,saved,events,documentEvents};
}
test('N64 rebinding swaps conflicts, persists, and samples all C buttons',()=>{
  const {api,saved}=runtime();
  let bindings=api.rebind(api.load(),'a','KeyK');
  assert.equal(bindings.a,'KeyK');assert.equal(bindings.b,'KeyJ');
  assert.equal(api.resolve('ControlLeft',bindings),null);
  bindings=api.rebind(bindings,'cdown','Digit1');
  bindings=api.rebind(bindings,'cleft','Digit2');
  bindings=api.rebind(bindings,'cright','Digit3');
  api.save(bindings);
  assert.equal(runtime(saved).api.load().a,'KeyK');
  assert.equal(api.sample(new Set(['KeyK','Digit1','Digit2','Digit3'])).button,0x8007);
  assert.equal(api.rebind(bindings,'a','Escape'),bindings);
  api.save(api.defaults());assert.equal(api.resolve('ControlLeft'),'a');
});
test('primary bindings override legacy aliases; opposite directions cancel',()=>{
  const {api}=runtime();
  const bindings=api.rebind(api.load(),'b','ArrowUp');
  assert.equal(api.resolve('ArrowUp',bindings),'b');
  assert.equal(api.resolve('KeyK',bindings),null);
  assert.equal(api.sample(new Set(['ArrowUp']),bindings).button,0x4000);
  assert.equal(api.sample(new Set(['KeyW','KeyS']),bindings).sy,0);
});
test('malformed storage falls back; failed saves do not change current bindings',()=>{
  const {api,context}=runtime(new Map([['opensmash-n64-keyboard-v1','invalid']]));
  assert.equal(api.load().a,'KeyJ');
  context.localStorage.setItem=()=>{throw Error('quota');};
  assert.throws(()=>api.save(api.rebind(api.load(),'a','KeyP')));
  assert.equal(api.load().a,'KeyJ');
});
test('browser engine samples physical remaps while retaining synthetic touch input',()=>{
  const {api,context,events,documentEvents}=runtime();
  api.save(api.rebind(api.load(),'a','KeyP'));
  api.installEngine();
  const heap=new Int32Array(16);context.Module={HEAP32:heap};
  context.controllerPorts={readPorts:()=>{heap.fill(0);heap[0]=2;heap[1]=8;heap[2]=40;heap[4]=3;heap[5]=0x4000;}};
  documentEvents.get('DOMContentLoaded')();
  const dispatch=(name,code,isTrusted=true)=>{
    let stopped=false;
    for(const fn of events.get(name)) fn({code,isTrusted,preventDefault(){},stopImmediatePropagation(){stopped=true;}});
    return stopped;
  };
  assert.equal(dispatch('keydown','KeyP'),true);
  assert.equal(dispatch('keydown','KeyJ',false),false);
  context.controllerPorts.readPorts(0);
  assert.equal(heap[1],0x8008);assert.equal(heap[2],40);assert.equal(heap[5],0x4000);
  dispatch('keyup','KeyP');context.controllerPorts.readPorts(0);assert.equal(heap[1],8);
  dispatch('keydown','KeyP');dispatch('keyup','KeyP');
  context.controllerPorts.readPorts(0);assert.equal(heap[1],0x8008);
  context.controllerPorts.readPorts(0);assert.equal(heap[1],8);
  dispatch('keydown','KeyJ');context.controllerPorts.readPorts(0);assert.equal(heap[1],8);
  dispatch('keydown','KeyP');events.get('blur')[0]();context.controllerPorts.readPorts(0);assert.equal(heap[1],8);
  dispatch('keydown','KeyP');api.save(api.defaults());context.controllerPorts.readPorts(0);assert.equal(heap[1],8);
});
