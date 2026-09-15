const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
// Fixed, bounded logical-controller packet. Only the main process owns the path.
function createInput(directory){
 const file=path.join(directory,'launcher-input-'+randomUUID());
 const fd=fs.openSync(file,'wx+',0o600);let owner=null;const bytes=Buffer.alloc(80);bytes.write('OSI1');bytes[4]=1;
 function write(){bytes[5]=(bytes[5]+1)&255;fs.writeSync(fd,bytes,0,bytes.length,0);}
 function neutral(){bytes.fill(0,8);write();}
 write();
 return {file,
  begin(session){owner=session;neutral();},
  stop(session){if(session&&session!==owner)return;owner=null;neutral();},
  mute(value){bytes[4]=value?1:0;write();},
  update(session,ports){
   if(session!==owner||!Array.isArray(ports)||ports.length!==4)return false;
   if(!ports.every(p=>Array.isArray(p)&&p.length===9&&p.every(Number.isInteger)&&p[0]>=0&&p[0]<=3&&p[1]>=0&&p[1]<=1&&p[2]>=0&&p[2]<=65535&&p.slice(3,7).every(v=>v>=-128&&v<=127)&&p.slice(7).every(v=>v>=0&&v<=255)))return false;
   ports.forEach((p,i)=>{const o=8+i*16;bytes[o]=p[0];bytes[o+1]=p[1];bytes.writeUInt16LE(p[2],o+2);p.slice(3,7).forEach((v,j)=>bytes.writeInt16LE(v,o+4+j*2));bytes[o+12]=p[7];bytes[o+13]=p[8];});
   write();return true;
  },
  close(){fs.closeSync(fd);fs.rmSync(file,{force:true});},
 };
}
module.exports={createInput};
