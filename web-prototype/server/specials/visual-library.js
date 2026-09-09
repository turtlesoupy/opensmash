// Reusable construction, selected explicitly in the score; never by character/name.
// Bellows geometry preserves the approved prototype's separated folds and rigid cases.
export function constructProp(prop) {
 const out=[],accent=prop.pieces[0].color;
 const rect=(at,size,rgb,extra={})=>out.push({at,size,rgb,color:accent,angle:0,...extra});
 switch(prop.construction||'pieces') {
 case 'bellows': {
  const r=(x,y,z,w,h,rgb,extension=0,stretch=false)=>rect([x,y,z],[w,h],rgb,{articulated:true,extension,stretch});
  r(0,0,0,125,74,[37,31,58],0,true);
  for(let i=0;i<13;i++) {
   const x=-125+250*i/12;
   r(0,0,2,125/16,70,i%2?[162,45,100]:[68,24,59],x,true);
   r(-2,0,4,2,70,[238,189,111],x);
  }
  for(const side of [-1,1]) {
   r(side*25,0,8,35,94,[38,27,43],side*125);
   r(side*25,0,10,29,87,[204,44,62],side*125);
  }
  for(let i=0;i<8;i++) {
   const y=-70+i*20;
   r(27,y,12,23,9,[255,246,215],125);
   if(i%3!==0)r(12,y+8,14,11,4,[35,28,48],125);
   r(-25,y,12,4,4,[255,218,119],-125);
  }
  break;
 }
 case 'music-note':
  rect([0,0,0],[19,11],[255,228,143],{angle:.15});
  rect([15,28,0],[4,30],[255,228,143]);
  rect([29,54,0],[16,5],[255,228,143],{angle:-.3});
  break;
 case 'straw': {
  // A compact, outlined sheaf stays readable against foliage and at phone scale.
  const stalks=[{at:[-15,0,0],size:[9,66],angle:-.32,rgb:[255,218,99]},
   {at:[14,2,1],size:[9,60],angle:.3,rgb:[255,248,185]},
   {at:[-1,-8,2],size:[33,8],angle:.15,rgb:[255,186,65]}];
  for(const p of stalks)rect(p.at,p.size.map(x=>x+4),[69,39,35],{angle:p.angle});
  for(const p of stalks)rect([p.at[0],p.at[1],p.at[2]+4],p.size,p.rgb,{angle:p.angle});
  break;
 }
 case 'pieces':return prop.pieces.flatMap(p=>Array.from({length:p.repeat},(_,k)=>({...p,at:p.at.map((x,j)=>x+p.step[j]*k)})));
 default:throw new Error('unknown prop construction');
 }
 return out;
}
