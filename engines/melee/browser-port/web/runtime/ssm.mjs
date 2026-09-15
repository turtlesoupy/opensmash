/** Decode only SSM metadata into the host ABI. DSP sample bytes stay big endian.
 * Layout comes from HSD_SynthSFXHeaderLoadCallback/SampleLoadCallback and AXPB.
 * Returns a copy; the user's verified disc bytes are never modified.
 */
export function normalizeSSM(source) {
  const bytes=new Uint8Array(source.buffer??source,source.byteOffset??0,source.byteLength);
  if(bytes.length<32)throw new Error('Truncated SSM header');
  const out=bytes.slice(),input=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),view=new DataView(out.buffer);
  const headerBytes=input.getUint32(0),sampleBytes=input.getUint32(4),count=input.getUint32(8);
  const metadataEnd=16+headerBytes,sampleStart=Math.ceil(metadataEnd/32)*32;
  if(headerBytes<8 || metadataEnd>bytes.length || sampleStart>bytes.length || sampleBytes>bytes.length-sampleStart)throw new Error('Invalid SSM section bounds');
  for(let p=0;p<16;p+=4)view.setUint32(p,input.getUint32(p),true);
  let p=16;
  for(let i=0;i<count;i++) {
    if(p+8>metadataEnd)throw new Error('Truncated SSM sound descriptor');
    const voices=input.getUint32(p);
    if(voices<1 || voices>2 || p+8+voices*64>metadataEnd)throw new Error('Invalid SSM voice count');
    view.setUint32(p,voices,true);view.setUint32(p+4,input.getUint32(p+4),true);p+=8;
    for(let voice=0;voice<voices;voice++) {
      for(let j=0;j<64;j+=2)view.setUint16(p+j,input.getUint16(p+j),true);
      p+=64;
    }
  }
  if(p!==metadataEnd)throw new Error(`SSM metadata size mismatch: ${p}/${metadataEnd}`);
  return out;
}

/** SEM contains five counted u32 tables followed by u32 synth instructions. */
export function normalizeSEM(source) {
  const bytes=new Uint8Array(source.buffer??source,source.byteOffset??0,source.byteLength);
  if(bytes.length%4)throw new Error('Unaligned SEM file');
  const input=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),out=bytes.slice(),view=new DataView(out.buffer);
  let p=0;
  for(let table=0;table<5;table++) {
    if(p+4>bytes.length)throw new Error('Truncated SEM table');
    const count=input.getUint32(p);p+=4;
    if(count>(bytes.length-p)/4)throw new Error('Invalid SEM table count');
    if(table===1 || table===3 || table===4)for(let i=0;i<count;i++) {
      const offset=input.getUint32(p+i*4);
      if(offset%4 || offset>=bytes.length)throw new Error('Invalid SEM instruction address');
    }
    p+=count*4;
  }
  for(let i=0;i<bytes.length;i+=4)view.setUint32(i,input.getUint32(i),true);
  return out;
}
