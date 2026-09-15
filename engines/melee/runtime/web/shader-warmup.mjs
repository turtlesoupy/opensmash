/* Portable Dolphin pipeline descriptions; preserve locally learned entries. */
export function mergePipelineCaches(seed, existing, recordBytes) {
  if(!Number.isInteger(recordBytes)||recordBytes<=0||seed.length<8||
     (seed.length-8)%recordBytes)throw Error('Invalid graphics preparation layout.');
  const records=new Map();
  const add=bytes=>{
    for(let i=8;i<bytes.length;i+=recordBytes) {
      const record=bytes.subarray(i,i+recordBytes);
      records.set(String.fromCharCode(...record),record);
    }
  };
  add(seed);
  if(existing?.length>=8 && (existing.length-8)%recordBytes===0 &&
     seed.subarray(0,8).every((byte,i)=>existing[i]===byte))add(existing);
  const merged=new Uint8Array(8+records.size*recordBytes);
  merged.set(seed.subarray(0,8));
  let offset=8;
  for(const record of records.values()){merged.set(record,offset);offset+=recordBytes;}
  return merged;
}
