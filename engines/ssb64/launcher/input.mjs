// The same standard-mapping inputs consumed by the WASM shell. navigator's
// gamepads have already passed through the authoritative site remapper.
export function samplePad(pad){
 if(!pad?.connected)return [3,0,0,0,0,0,0,0,0];
 const pressed=i=>pad.buttons[i]?.pressed||pad.buttons[i]?.value>.5;
 const axis=i=>Number.isFinite(pad.axes[i])?Math.max(-1,Math.min(1,pad.axes[i])):0;
 let button=0;for(const [i,bit] of [[0,0x8000],[1,0x4000],[2,8],[3,8],[4,0x20],[5,0x10],[7,0x10],[6,0x2000],[9,0x1000],[12,0x800],[13,0x400],[14,0x200],[15,0x100]])if(pressed(i))button|=bit;
 if(axis(3)<-.5)button|=8;if(axis(3)>.5)button|=4;if(axis(2)<-.5)button|=2;if(axis(2)>.5)button|=1;
 let x=axis(0),y=axis(1),length=Math.hypot(x,y);
 if(length<.15){x=0;y=0;}else{const scale=Math.min(1,(length-.15)/.85)/length;x*=scale;y*=scale;}
 return [3,1,button,Math.round(x*80),(Math.round(-y*80)||0),0,0,0,0];
}
export function samplePorts(plan,pads,blocked=false){
 const used=new Set();
 return plan.map(p=>{
  if(blocked)return [1,0,0,0,0,0,0,0,0];
  if(p?.kind==='keyboard')return [2,1,0,0,0,0,0,0,0];
  if(p?.kind!=='gamepad')return [1,0,0,0,0,0,0,0,0];
  const pad=pads.find(g=>g?.connected&&!used.has(g.index)&&g.index===p.index&&(!p.id||g.id===p.id))||pads.find(g=>g?.connected&&!used.has(g.index)&&g.id===p.id);
  if(pad)used.add(pad.index);return samplePad(pad);
 });
}

export function sampleKeyboard(keys){
 const held=(...names)=>names.some(n=>keys.has(n));let buttons=0;
 for(const [names,bit] of [[['KeyJ','ControlLeft','ControlRight'],0x8000],[['KeyK','AltLeft','AltRight'],0x4000],[['KeyL','ShiftLeft','ShiftRight'],0x2000],[['Enter','NumpadEnter','Space'],0x1000],[['KeyI'],0x20],[['KeyO'],0x10],[['KeyU'],8],[['KeyT'],0x800],[['KeyG'],0x400],[['KeyF'],0x200],[['KeyH'],0x100]])if(held(...names))buttons|=bit;
 return [2,1,buttons,80*(Number(held('KeyD','ArrowRight'))-Number(held('KeyA','ArrowLeft'))),80*(Number(held('KeyW','ArrowUp'))-Number(held('KeyS','ArrowDown'))),0,0,0,0];
}
