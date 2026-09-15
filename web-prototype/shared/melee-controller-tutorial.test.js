import test from 'node:test';
import assert from 'node:assert/strict';
const store=new Map();
globalThis.window={};
globalThis.localStorage={getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};
let pads=[];
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>pads}});
const {defaults,saveBindings,rebindKey,rebindButton}=await import('../../engines/melee/web/lib/controls.ts');
const {loadMeleeKeycapLayout,meleeControlForEvent,meleeControlLabels,meleePadControls,meleeRequiredControls}=await import('../../engines/melee/launcher/controller-tutorial.ts');
test('Melee tutorial uses actual keyboard bindings, including remaps and every action',()=>{
 saveBindings(defaults());
 for(const [id,label] of Object.entries(meleeControlLabels()))assert.ok(label,id);
 assert.equal(meleeRequiredControls.length,16);
 assert.equal(meleeControlForEvent({code:'KeyU'}),'l');
 assert.equal(meleeControlForEvent({code:'KeyQ'}),'i');
 assert.equal(meleeControlForEvent({code:'Space'}),'x');
 assert.equal(meleeControlForEvent({code:'ArrowUp'}),'cup');
 saveBindings(rebindKey(defaults(),'a','KeyF'));
 assert.equal(meleeControlLabels().j,'F');
 assert.equal(meleeControlForEvent({code:'KeyF'}),'j');
 assert.equal(meleeControlForEvent({code:'KeyJ'}),undefined);
});
test('Melee tutorial uses per-device buttons and axis profiles',()=>{
 const pad={id:'Xbox test',connected:true,buttons:Array.from({length:16},()=>({pressed:false,value:0})),axes:[0,0,0,0,-1,1]};
 let b=rebindButton(defaults(),'a',3,pad.id);
 b.axisProfiles={[pad.id]:{x:4,y:5,cx:2,cy:3,invertX:true,invertY:false,invertCX:false,invertCY:false,deadzone:.15}};
 saveBindings(b);pads=[pad];pad.buttons[3]={pressed:true,value:1};
 assert.equal(meleeControlLabels().j,'Y');
 assert.deepEqual([...meleePadControls()].sort(),['d','j','s']);
 pads=[];saveBindings(defaults());
});

test('keyboard captions follow the physical keyboard layout with safe fallback',async()=>{
 saveBindings(defaults());
 await loadMeleeKeycapLayout({getLayoutMap:async()=>new Map([['KeyW','z'],['Space',' ']])});
 assert.equal(meleeControlLabels().w,'Z');
 assert.equal(meleeControlLabels().x,'Space');
 assert.equal(meleeControlForEvent({code:'KeyW'}),'w');
 await loadMeleeKeycapLayout({getLayoutMap:async()=>{throw Error('Unavailable');}});
 assert.equal(meleeControlLabels().w,'W');
});
