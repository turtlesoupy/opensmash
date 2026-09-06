export function objBundle() {
  const length=24+4+28*3+8, bytes=new Uint8Array(24+2*(8+length)), view=new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("OSB6"));
  view.setUint32(4,2,true);view.setUint32(8,2,true);view.setUint32(12,2,true);
  [0xf801,0x07c1,0x003f,0xffff].forEach((p,i)=>view.setUint16(16+i*2,p));
  for(let target=0;target<2;target++) {
    const header=24+target*(8+length),payload=header+8,vertices=payload+28;
    view.setUint32(header,target===0?0:3,true);view.setUint32(header+4,length,true);
    bytes.set(new TextEncoder().encode("OSB5"),payload);
    view.setUint32(payload+4,1,true);view.setUint32(payload+8,3,true);view.setUint32(payload+12,1,true);
    for(let i=0;i<3;i++) {
      const at=vertices+i*28;
      view.setFloat32(at,(i===1?1:0)+target*10,true);view.setFloat32(at+4,i===2?1:0,true);
      view.setInt16(at+12,i===1?64:0,true);view.setInt16(at+14,i===2?64:0,true);view.setInt8(at+26,127);
      view.setUint16(vertices+84+i*2,i,true);
    }
  }
  return bytes;
}
