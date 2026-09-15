// Android content providers make each Blob read expensive. Reuse bounded blocks
// for the game's small synchronous reads; never retain the full disc in RAM.
export function installDiscReadCache(workerFS, {blockBytes=4*1024*1024, maxBytes=32*1024*1024}={}) {
  if(!Number.isSafeInteger(blockBytes)||blockBytes<=0||!Number.isSafeInteger(maxBytes)||maxBytes<blockBytes)throw Error('Invalid disc cache bounds.');
  const original=workerFS.stream_ops.read;
  const blocks=new Map();
  let used=0;
  const stats={reads:0,hits:0,bytes:0};
  workerFS.stream_ops.read=function(stream,buffer,offset,length,position){
    const node=stream.node;
    if(position>=node.size||length===0)return 0;
    const count=Math.min(length,node.size-position);
    let copied=0;
    while(copied<count){
      const at=position+copied,start=Math.floor(at/blockBytes)*blockBytes;
      const key=node.id+':'+start;
      let block=blocks.get(key);
      if(block){blocks.delete(key);blocks.set(key,block);stats.hits++;}
      else{
        const end=Math.min(start+blockBytes,node.size);
        while(used+end-start>maxBytes&&blocks.size){const oldest=blocks.keys().next().value;used-=blocks.get(oldest).length;blocks.delete(oldest);}
        block=new Uint8Array(workerFS.reader.readAsArrayBuffer(node.contents.slice(start,end)));
        if(block.length!==end-start)throw Error('The selected disc could not be read completely.');
        stats.reads++;stats.bytes+=block.length;
        if(block.length<=maxBytes){blocks.set(key,block);used+=block.length;}
      }
      const take=Math.min(count-copied,block.length-(at-start));
      buffer.set(block.subarray(at-start,at-start+take),offset+copied);
      copied+=take;
    }
    return copied;
  };
  return {stats,clear(){blocks.clear();used=0;},restore(){workerFS.stream_ops.read=original;blocks.clear();used=0;}};
}
