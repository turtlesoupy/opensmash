export function editableN64Profile(saved) {
  if (saved?.mode === 'custom') return saved;
  const result = {mode:'custom',buttons:{a:0,b:1,l:4,r:5,z:6,start:9,dup:12,ddown:13,dleft:14,dright:15},axes:{}};
  for (const [negative,positive,index] of [['left','right',0],['up','down',1],['cleft','cright',2],['cup','cdown',3]]) {
    result.axes[negative]={index,value:-1,neutral:0};result.axes[positive]={index,value:1,neutral:0};
  }
  for (const [control,index] of Object.entries(saved?.buttons||{})) {result.buttons[control]=index;delete result.axes[control];}
  for (const [control,axis] of Object.entries(saved?.axes||{})) {result.axes[control]=axis;delete result.buttons[control];}
  return result;
}
export function rebindN64Gamepad(mapping, control, binding) {
  const next={mode:'custom',buttons:{...mapping.buttons},axes:{...mapping.axes}};
  const kind=typeof binding==='number'?'buttons':'axes';
  const conflict=Object.keys(next[kind]).find(key=>key!==control&&(kind==='buttons'?next.buttons[key]===binding:next.axes[key].index===binding.index&&Math.sign(next.axes[key].value-next.axes[key].neutral)===Math.sign(binding.value-binding.neutral)));
  if(conflict) {
    delete next.buttons[conflict];delete next.axes[conflict];
    if(mapping.buttons[control]!==undefined)next.buttons[conflict]=mapping.buttons[control];
    else if(mapping.axes[control])next.axes[conflict]=mapping.axes[control];
  }
  delete next.buttons[control];delete next.axes[control];next[kind][control]=binding;
  return next;
}
