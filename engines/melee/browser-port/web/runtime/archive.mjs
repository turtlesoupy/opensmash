import {normalizeParticleBanks} from './particle-bank.mjs';
/** HSD archive metadata and typed payload conversion for wasm32.
 * Relocations retain their original meaning; opaque bytes (textures, compressed
 * animation and GX display lists) are never blanket-swapped.
 */
export class TypedArchive {
  constructor(memory,ptr,size) {
    if(ptr<0 || size<32 || ptr+size>memory.buffer.byteLength)throw new Error('Archive outside memory');
    this.memory=memory;this.ptr=ptr;this.raw=new Uint8Array(memory.buffer,ptr,size).slice();
    this.input=new DataView(this.raw.buffer);this.size=size;this.converted=new Set();
    const r=this.input;
    if(r.getUint32(0)!==size)throw new Error('Archive size mismatch');
    this.dataSize=r.getUint32(4);this.data=ptr+32;
    const nr=r.getUint32(8),np=r.getUint32(12),ne=r.getUint32(16);
    const relocStart=32+this.dataSize,publicStart=relocStart+nr*4,externStart=publicStart+np*8,strings=externStart+ne*8;
    if(strings>size || this.dataSize>size-32)throw new Error('Archive tables exceed file');
    this.relocations=new Set();this.roots=new Map();const patches=new Map();
    const scalar=(p)=>{patches.set(p,r.getUint32(p));};
    for(const p of [0,4,8,12,16,24,28])scalar(p);
    for(let i=0;i<nr;i++) {
      const p=relocStart+i*4,offset=r.getUint32(p);
      if(offset%4 || offset>this.dataSize-4 || this.relocations.has(offset))throw new Error('Invalid archive relocation');
      const target=r.getUint32(32+offset);
      if(target>this.dataSize)throw new Error('Archive relocation target outside data');
      this.relocations.add(offset);scalar(p);scalar(32+offset);
    }
    const symbol=(offset)=>{
      const begin=strings+offset,end=this.raw.indexOf(0,begin);
      if(begin>=size || end<begin)throw new Error('Invalid archive symbol');
      return new TextDecoder().decode(this.raw.subarray(begin,end));
    };
    for(let i=0;i<np+ne;i++) {
      const p=publicStart+i*8,offset=r.getUint32(p),name=symbol(r.getUint32(p+4));
      if(offset>this.dataSize)throw new Error('Archive symbol outside data');
      scalar(p);scalar(p+4);
      if(i<np)this.roots.set(name,offset);
      else {
        const visited=new Set();let next=offset;
        while(next!==0xffffffff) {
          if(next%4 || next>this.dataSize-4 || visited.has(next))throw new Error('Invalid archive external chain');
          visited.add(next);scalar(32+next);next=r.getUint32(32+next);
        }
      }
    }
    this.boundaries=[...new Set([this.dataSize,...this.roots.values(),...[...this.relocations].map(p=>r.getUint32(32+p))])].sort((a,b)=>a-b);
    // Validate the whole metadata graph before changing any bytes.
    const view=new DataView(memory.buffer);
    for(const [p,value] of patches)view.setUint32(ptr+p,value,true);
  }
  bound(offset) { return this.boundaries.find(p=>p>offset)??this.dataSize; }
  field(offset,width=4) {
    if(offset<0 || offset+width>this.dataSize)throw new Error('Typed field outside archive');
    const key=`${offset}/${width}`;if(this.converted.has(key))return;
    if(this.relocations.has(offset))throw new Error('Attempt to reinterpret an archive pointer as scalar');
    const value=width===2?this.input.getUint16(32+offset):this.input.getUint32(32+offset);
    const output=new DataView(this.memory.buffer);
    if(width===2)output.setUint16(this.data+offset,value,true);else output.setUint32(this.data+offset,value,true);
    this.converted.add(key);
  }
  pointer(offset) {
    if(!this.relocations.has(offset)) {
      if(this.input.getUint32(32+offset)!==0)throw new Error('Non-null descriptor pointer missing relocation');
      return null;
    }
    return this.input.getUint32(32+offset);
  }
  type(offset,kind) {
    if(kind!==0)throw new Error('Unknown archive descriptor kind');
    // EF_EffectDesc::lifetime followed by a StaticModelDesc.
    if(offset<0 || offset+20>this.dataSize)throw new Error('Effect descriptor outside archive');
    for(let i=4;i<20;i+=4)if(this.pointer(offset+i)!==null)throw new Error('Effect model descriptor schema is not implemented');
    this.field(offset);
  }
  symbol(name) {
    const offset=this.roots.get(name);if(offset===undefined)return;
    if(/^eff.*DataTable$/.test(name)) {
      const command=this.pointer(offset),texture=this.pointer(offset+4);
      if(command!==null || texture!==null)normalizeParticleBanks(this,command,texture);
      // The effect-load boundary rejects model schemas that are not yet implemented.
      return;
    }
    if(name==='plLoadCommonData') {
      const data=this.pointer(offset);
      if(data===null || data+0x184>this.dataSize)throw new Error('Invalid player common-data descriptor');
      for(let p=0;p<0x184;p+=4)if(p!==0xC0)this.field(data+p);
      return;
    }
    if(name==='lbRefData') {
      const count=this.input.getUint8(32+offset),values=this.pointer(offset+4);
      if(count && values===null)throw new Error('Refraction parameters missing');
      for(let i=0;i<count*2;i++)this.field(values+i*4);
      return;
    }
    if(name==='MemCardIconData') {
      for(let i=0;i<4;i++)this.pointer(offset+i*4);
      return; // Four pointers to raw memory-card image data.
    }
    if(name==='lbRumbleData') {
      const end=this.bound(offset);
      if((end-offset)%8)throw new Error('Invalid rumble table size');
      for(let p=offset;p<end;p+=8) {
        const commands=this.pointer(p);if(commands===null)continue;
        const limit=this.bound(commands);
        for(let c=commands;c+2<=limit;c+=2)this.field(c,2);
      }
      return;
    }
    throw new Error(`Archive payload needs a typed schema: ${name} (${this.dataSize} bytes)`);
  }
}
