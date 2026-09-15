/** HSD particle banks contain their own relative offsets inside a DAT payload. */
export function normalizeParticleBanks(archive,commandBase,textureBase) {
  const a=archive,r=a.input;
  const u32=p=>r.getUint32(32+p),u16=p=>r.getUint16(32+p);
  const check=(p,size)=>{if(p<0 || size<0 || p+size>a.dataSize)throw new Error('Particle bank outside archive');};
  if(commandBase===null || textureBase===null)throw new Error('Incomplete particle bank pair');
  check(commandBase,12);
  const version=u16(commandBase);
  if(version!==0 && (version<0x40 || version>0x43))throw new Error('Unknown particle bank version');
  a.field(commandBase,2);a.field(commandBase+2,2);a.field(commandBase+4);
  const count=version===0?u32(commandBase+4):u32(commandBase+8),table=commandBase+(version===0?8:12);
  if(version!==0)a.field(commandBase+8);
  check(table,count*4);
  for(let i=0;i<count;i++) {
    const offset=u32(table+i*4);a.field(table+i*4);if(!offset && version!==0)continue;
    const p=commandBase+offset;check(p,60);
    for(let j=0;j<8;j+=2)a.field(p+j,2);
    for(let j=8;j<60;j+=4)a.field(p+j);
    // The command stream at +0x3C is bytecode, decoded by the interpreter.
  }
  check(textureBase,4);const groups=u32(textureBase);a.field(textureBase);check(textureBase+4,groups*4);
  for(let i=0;i<groups;i++) {
    const offset=u32(textureBase+4+i*4);a.field(textureBase+4+i*4);if(!offset)continue;
    const p=textureBase+offset;check(p,24);
    const count=u32(p),format=u32(p+4),palnum=u16(p+20),palflag=u16(p+22);
    let pointers=count;
    if(format>=8 && format<=10)pointers+=(palflag&1)?1:(palnum||count);
    check(p+24,pointers*4);
    for(let j=0;j<20;j+=4)a.field(p+j);
    a.field(p+20,2);a.field(p+22,2);
    for(let j=0;j<pointers;j++) {
      const rel=u32(p+24+j*4);if(rel)check(textureBase+rel,1);
      a.field(p+24+j*4);
    }
  }
}
