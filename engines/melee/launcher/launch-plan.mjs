export function selectionPorts(plan,selectionMode,mode=0){
 const humans=plan.flatMap((slot,index)=>['keyboard','gamepad'].includes(slot?.kind)?[index]:[]);
 const cpus=plan.flatMap((slot,index)=>!slot||slot.kind==='cpu'?[index]:[]);
 return selectionMode==='full-roster'&&mode===0?[...humans,...cpus]:humans;
}
// Translate the launcher's device assignments and ordered roster picks; all
// costume allocation and engine validation remain in Melee's planLaunch.
export function applyLauncherSelection(settings, action) {
  if (!action.portPlan) return settings;
  if (action.portPlan.length !== 4) throw Error('Four player assignments are required.');
  const picks=[action.character,...(action.picks||[])].filter(Boolean);
  const mode=action.type==='start'?4:action.type==='select'?2:settings.mode;
  const selectedPorts=selectionPorts(action.portPlan,action.selectionMode,mode);
  return {...settings,mode,ports:settings.ports.map((port,index)=>{
    const slot=action.portPlan[index];
    const device=slot?.kind==='gamepad'?`gamepad${slot.index}`:slot?.kind==='keyboard'?'keyboard':slot?.kind==='none'?'off':'cpu';
    const chosen=picks[selectedPorts.indexOf(index)];
    return {...port,device,character:chosen?.slug || (device==='off'?'vanilla:2':port.character==='selected'?'random':port.character)};
  })};
}
