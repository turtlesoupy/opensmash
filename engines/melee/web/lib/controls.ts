import {preferences} from './desktop.ts';

// GameCube controls the game reads, in the order the Controls screen lists them.
export const actions=[
 {id:'up',label:'Move up',group:'stick'},
 {id:'down',label:'Move down',group:'stick'},
 {id:'left',label:'Move left',group:'stick'},
 {id:'right',label:'Move right',group:'stick'},
 {id:'a',label:'Attack / confirm',group:'button'},
 {id:'b',label:'Special / back',group:'button'},
 {id:'x',label:'Jump',group:'button'},
 {id:'y',label:'Jump (alternate)',group:'button'},
 {id:'z',label:'Grab',group:'button'},
 {id:'l',label:'Shield',group:'button'},
 {id:'r',label:'Shield (alternate)',group:'button'},
 {id:'start',label:'Start / pause',group:'button'},
 {id:'cup',label:'Smash attack up',group:'cstick'},
 {id:'cdown',label:'Smash attack down',group:'cstick'},
 {id:'cleft',label:'Smash attack left',group:'cstick'},
 {id:'cright',label:'Smash attack right',group:'cstick'},
] as const;
export type Action=(typeof actions)[number]['id'];
export type ButtonAction='a'|'b'|'x'|'y'|'z'|'l'|'r'|'start';
export const buttonActions:ButtonAction[]=['a','b','x','y','z','l','r','start'];
export type StickAxes={x:number;y:number;cx:number;cy:number;invertX:boolean;invertY:boolean;invertCX:boolean;invertCY:boolean;deadzone:number};
export const defaultAxes:StickAxes={x:0,y:1,cx:2,cy:3,invertX:false,invertY:false,invertCX:false,invertCY:false,deadzone:.15};
export type Bindings={axes?:StickAxes;axisProfiles?:Record<string,StickAxes>;keyboard:Record<Action,string>;gamepad:Record<ButtonAction,number>;profiles?:Record<string,Record<ButtonAction,number>>};

// Physical DOM key codes: the right-hand cluster stays under the fingers on every layout.
export const defaultKeyboard:Record<Action,string>={
 up:'KeyW',down:'KeyS',left:'KeyA',right:'KeyD',
 a:'KeyJ',b:'KeyK',x:'Space',y:'KeyI',z:'KeyU',l:'KeyQ',r:'KeyE',start:'Enter',
 cup:'ArrowUp',cdown:'ArrowDown',cleft:'ArrowLeft',cright:'ArrowRight',
};
// Standard-mapping gamepad button indexes (W3C layout: 0 = bottom face button).
export const defaultGamepad:Record<ButtonAction,number>={a:0,b:1,x:2,y:3,z:5,l:6,r:7,start:9};
export const defaults=():Bindings=>({keyboard:{...defaultKeyboard},gamepad:{...defaultGamepad}});

// Keys every input backend (browser, Electron surface, Dolphin's Quartz / DInput / XInput2) can name.
export const bindableKeys=new Set([
 ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(c=>'Key'+c),
 ...'0123456789'.split('').map(c=>'Digit'+c),
 'Space','Enter','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',
]);
export const maxGamepadButton=16;

const STORAGE='melee-controls-v1';
let current:Bindings|null=null;
const listeners=new Set<()=>void>();
export function loadBindings():Bindings {
 if(current)return current;
 const b=defaults();
 try{
  const saved=JSON.parse(preferences.getItem(STORAGE)||'{}');
  for(const action of actions){const code=saved?.keyboard?.[action.id];if(typeof code==='string'&&bindableKeys.has(code))b.keyboard[action.id]=code;}
  for(const action of buttonActions){const index=saved?.gamepad?.[action];if(Number.isInteger(index)&&index>=0&&index<maxGamepadButton)b.gamepad[action]=index;}
  b.axes=validAxes(saved.axes);
  if(saved.axisProfiles&&typeof saved.axisProfiles==='object'&&!Array.isArray(saved.axisProfiles))b.axisProfiles=Object.fromEntries(Object.entries(saved.axisProfiles).slice(0,64).filter(([id])=>id.length<=1024).map(([id,value])=>[id,validAxes(value)]));
  if(saved.profiles&&typeof saved.profiles==='object'&&!Array.isArray(saved.profiles)){
   b.profiles=Object.fromEntries(Object.entries(saved.profiles).slice(0,64).filter(([id])=>id.length<=1024).map(([id,mapping])=>[id,validGamepad(mapping,b.gamepad)]));
  }
 }catch{}
 return current=b;
}
export function saveBindings(b:Bindings){
 current=b;
 try{preferences.setItem(STORAGE,JSON.stringify(b));}catch{}
 for(const listener of listeners)listener();
}
export function subscribeBindings(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}

// Assign a key to an action; a key already used elsewhere swaps places so nothing is left unbound.
export function rebindKey(b:Bindings,action:Action,code:string):Bindings {
 if(!bindableKeys.has(code))return b;
 const keyboard={...b.keyboard};
 const other=(Object.keys(keyboard) as Action[]).find(id=>keyboard[id]===code&&id!==action);
 if(other)keyboard[other]=keyboard[action];
 keyboard[action]=code;
 return {...b,keyboard};
}
function validGamepad(value:unknown,fallback=defaultGamepad):Record<ButtonAction,number>{
 const mapping={...fallback};
 if(value&&typeof value==='object')for(const action of buttonActions){
  const index=(value as Record<string,unknown>)[action];
  if(typeof index==='number'&&Number.isInteger(index)&&index>=0&&index<maxGamepadButton)mapping[action]=index;
 }
 return mapping;
}
// Identity survives browser index changes. Identical models share a profile.
export function gamepadBindings(b:Bindings,id?:string):Record<ButtonAction,number>{return id&&Object.hasOwn(b.profiles||{},id)?b.profiles![id]:b.gamepad;}
export function rebindButton(b:Bindings,action:ButtonAction,index:number,id?:string):Bindings {
 if(!Number.isInteger(index)||index<0||index>=maxGamepadButton)return b;
 const gamepad={...gamepadBindings(b,id)};
 const other=buttonActions.find(key=>gamepad[key]===index&&key!==action);
 if(other)gamepad[other]=gamepad[action];
 gamepad[action]=index;
 return id?{...b,profiles:{...b.profiles,[id]:gamepad}}:{...b,gamepad};
}
export function resetGamepad(b:Bindings,id?:string):Bindings{
 if(!id)return {...b,gamepad:{...defaultGamepad},axes:{...defaultAxes}};
 const profiles={...b.profiles},axisProfiles={...b.axisProfiles};delete profiles[id];delete axisProfiles[id];return {...b,profiles,axisProfiles};
}
// Freeze each connected device's mapping for the native launch request, while
// keeping the saved profiles independent of volatile browser slot numbers.
export function nativeBindings(){
 const b=loadBindings();
 return {...b,gamepads:Object.fromEntries(connectedGamepads().map(p=>[`gamepad${p.index}`,gamepadBindings(b,p.id)]))};
}

export function keyLabel(code:string):string {
 if(code.startsWith('Key'))return code.slice(3);
 if(code.startsWith('Digit'))return code.slice(5);
 return {Space:'Space',Enter:'Enter',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→'}[code]||code;
}

// Face-button captions per controller family; sticks and triggers read the same everywhere.
export type PadFamily='xbox'|'playstation'|'switch'|'gamecube'|'generic';
const padLabels:Record<PadFamily,string[]>={
 xbox:['A','B','X','Y','LB','RB','LT','RT','View','Menu','LS','RS','D-Up','D-Down','D-Left','D-Right'],
 playstation:['✕','○','□','△','L1','R1','L2','R2','Share','Options','L3','R3','D-Up','D-Down','D-Left','D-Right'],
 switch:['B','A','Y','X','L','R','ZL','ZR','−','+','LS','RS','D-Up','D-Down','D-Left','D-Right'],
 gamecube:['A','X','B','Y','Z','R','L','Z','','Start','','','D-Up','D-Down','D-Left','D-Right'],
 generic:['1','2','3','4','L1','R1','L2','R2','Select','Start','L3','R3','D-Up','D-Down','D-Left','D-Right'],
};
export function padFamily(id:string):PadFamily {
 if(/dualsense|dualshock|playstation|sony|054c/i.test(id))return 'playstation';
 if(/nintendo|switch|joy-con|pro controller|057e/i.test(id))return 'switch';
 if(/xbox|xinput|microsoft|045e/i.test(id))return 'xbox';
 if(/gamecube|mayflash|wii u|wup-028/i.test(id))return 'gamecube';
 return 'generic';
}
export const familyNames:Record<PadFamily,string>={xbox:'Xbox',playstation:'PlayStation',switch:'Nintendo Switch',gamecube:'GameCube',generic:'gamepad'};
export function padLabel(index:number,family:PadFamily='xbox'):string {return padLabels[family][index]||'Button '+(index+1);}

export function rawGamepads(): (Gamepad|null)[] {
 const remapper=(window as any).openSmashControllerRemap;
 return remapper?.rawGamepads ? remapper.rawGamepads() : [...(navigator.getGamepads?.()||[])];
}
export function connectedGamepads():Gamepad[] {
 try{return rawGamepads().filter((p):p is Gamepad=>!!p&&p.connected);}catch{return [];}
}
export const stickThreshold=0.5;
// Which actions a gamepad currently holds, for the Controls screen's live highlight.
export function padActions(pad:Gamepad,gamepad:Record<ButtonAction,number>,axes:StickAxes=defaultAxes):Set<Action> {
 const active=new Set<Action>();
 for(const action of buttonActions){const b=pad.buttons[gamepad[action]];if(b&&(b.pressed||b.value>0.5))active.add(action);}
 const axis=(n:number,invert:boolean)=>((pad.axes[n]||0)*(invert?-1:1));
 if(axis(axes.y,axes.invertY)<-stickThreshold)active.add('up');if(axis(axes.y,axes.invertY)>stickThreshold)active.add('down');
 if(axis(axes.x,axes.invertX)<-stickThreshold)active.add('left');if(axis(axes.x,axes.invertX)>stickThreshold)active.add('right');
 if(axis(axes.cy,axes.invertCY)<-stickThreshold)active.add('cup');if(axis(axes.cy,axes.invertCY)>stickThreshold)active.add('cdown');
 if(axis(axes.cx,axes.invertCX)<-stickThreshold)active.add('cleft');if(axis(axes.cx,axes.invertCX)>stickThreshold)active.add('cright');
 return active;
}
// Normalise a keyboard event to a physical code, including browsers that only report the key.
export function eventCode(e:KeyboardEvent):string {
 if(e.code)return e.code;
 if(/^[a-z]$/i.test(e.key))return 'Key'+e.key.toUpperCase();
 if(/^[0-9]$/.test(e.key))return 'Digit'+e.key;
 return e.key===' '?'Space':e.key;
}

export function sampleMeleePad(pad:Gamepad|null|undefined, b=loadBindings()):number[]{
 if(!pad?.connected)return [3,0,0,0,0,0,0,0,0];
 const map=gamepadBindings(b,pad.id),bits:Record<ButtonAction,number>={a:0x100,b:0x200,x:0x400,y:0x800,z:0x10,l:0x40,r:0x20,start:0x1000};
 let buttons=0;for(const action of buttonActions)if(pad.buttons[map[action]]?.pressed)buttons|=bits[action];
 [8,4,1,2].forEach((bit,i)=>{if(pad.buttons[12+i]?.pressed)buttons|=bit;});
 const axes=gamepadAxes(b,pad.id);
 const axis=(i:number,sign=1,invert=false)=>Math.round((Math.abs(pad.axes[i]||0)>axes.deadzone?Math.max(-1,Math.min(1,pad.axes[i])):0)*100*sign*(invert?-1:1))||0;
 return [3,1,buttons,axis(axes.x,1,axes.invertX),axis(axes.y,-1,axes.invertY),axis(axes.cx,1,axes.invertCX),axis(axes.cy,-1,axes.invertCY),Math.round((pad.buttons[map.l]?.value||0)*255),Math.round((pad.buttons[map.r]?.value||0)*255)];
}

export function gameInputBlocked(){return [...document.querySelectorAll('dialog[open], [role="dialog"][aria-modal="true"]')].some(element=>element.getClientRects().length>0);}

function validAxes(value:any):StickAxes{
 const result={...defaultAxes};
 for(const key of ['x','y','cx','cy'] as const)if(Number.isInteger(value?.[key])&&value[key]>=0&&value[key]<16)result[key]=value[key];
 for(const key of ['invertX','invertY','invertCX','invertCY'] as const)if(typeof value?.[key]==='boolean')result[key]=value[key];
 if(Number.isFinite(value?.deadzone)&&value.deadzone>=0&&value.deadzone<=.95)result.deadzone=value.deadzone;
 return result;
}
export function gamepadAxes(b:Bindings,id?:string):StickAxes{return validAxes(id&&Object.hasOwn(b.axisProfiles||{},id)?b.axisProfiles![id]:b.axes);}
export function rebindAxes(b:Bindings,value:StickAxes,id?:string):Bindings{return id?{...b,axisProfiles:{...b.axisProfiles,[id]:validAxes(value)}}:{...b,axes:validAxes(value)};}
