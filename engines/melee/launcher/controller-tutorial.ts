import {loadBindings, eventCode, keyLabel, connectedGamepads, gamepadBindings, gamepadAxes, padActions, padFamily, padLabel, type Action} from '../web/lib/controls.ts';
// Keep the launcher's animation IDs stable; resolve every caption/input through
// the same saved bindings used by the browser and native engine.
export const tutorialActions:Record<string,Action>={w:'up',a:'left',s:'down',d:'right',j:'a',k:'b',x:'x',y:'y',l:'z',i:'l',o:'r',start:'start',cup:'cup',cdown:'cdown',cleft:'cleft',cright:'cright'};
export const meleeRequiredControls=Object.keys(tutorialActions);
export function meleeControlForEvent(event:KeyboardEvent){
 const code=eventCode(event),bindings=loadBindings();
 return Object.keys(tutorialActions).find(key=>bindings.keyboard[tutorialActions[key]]===code);
}
let keyboardLayout: {get(code:string):string|undefined}|null=null;
export async function loadMeleeKeycapLayout(keyboard=(globalThis.navigator as Navigator & {keyboard?:{getLayoutMap():Promise<Map<string,string>>}})?.keyboard){
 try { keyboardLayout=keyboard?.getLayoutMap ? await keyboard.getLayoutMap() : null; }
 catch { keyboardLayout=null; }
}
function tutorialKeyLabel(code:string){
 const label=keyboardLayout?.get(code);
 return label?.length===1 && label.trim() ? label.toUpperCase() : keyLabel(code);
}
export function meleeControlLabels(){
 const bindings=loadBindings(),pad=connectedGamepads()[0];
 const mapping=gamepadBindings(bindings,pad?.id);
 return Object.fromEntries(Object.entries(tutorialActions).map(([key,action])=>[key,
  pad ? (action in mapping ? padLabel(mapping[action as keyof typeof mapping],padFamily(pad.id)) : ({up:'↑',left:'←',down:'↓',right:'→',cup:'↑',cleft:'←',cdown:'↓',cright:'→'}[action]||action)) : tutorialKeyLabel(bindings.keyboard[action])
 ]));
}
export function meleePadControls(){
 const b=loadBindings(),active=new Set<string>();
 for(const pad of connectedGamepads()){
  const actions=padActions(pad,gamepadBindings(b,pad.id),gamepadAxes(b,pad.id));
  for(const [key,action] of Object.entries(tutorialActions))if(actions.has(action))active.add(key);
 }
 return active;
}
export const meleeCalloutLayout={
 stick:{anchor:[.21,.35],label:[-.06,.24]},
 a:{anchor:[.78,.36],label:[1.12,.39]},
 b:{anchor:[.68,.43],label:[.94,.65]},
 x:{anchor:[.89,.33],label:[1.14,.20]},
 y:{anchor:[.76,.24],label:[.81,.06]},
 start:{anchor:[.50,.36],label:[.50,.04]},
 'c-buttons':{anchor:[.66,.63],label:[.66,.94]},
 z:{anchor:[.86,.18],label:[1.06,.02]},
 'left-bumper':{anchor:[.18,.18],label:[-.04,.02]},
 'right-bumper':{anchor:[.82,.18],label:[.98,-.12]},
};
