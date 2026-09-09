// Safari and remote mobile playback request byte ranges, including bytes=0-1.
export function videoResponse(bytes,range) {
 const headers={'Content-Type':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'private, no-store'};
 if(!range)return {status:200,headers:{...headers,'Content-Length':bytes.length},body:bytes};
 const m=/^bytes=(\d*)-(\d*)$/.exec(range);
 let start=m?.[1]?Number(m[1]):0,end=m?.[2]?Number(m[2]):bytes.length-1;
 if(m&&!m[1]&&m[2]) {start=Math.max(0,bytes.length-Number(m[2]));end=bytes.length-1;}
 end=Math.min(end,bytes.length-1);
 if(!m||(!m[1]&&!m[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=bytes.length)
  return {status:416,headers:{...headers,'Content-Range':`bytes */${bytes.length}`,'Content-Length':0},body:Buffer.alloc(0)};
 const body=bytes.subarray(start,end+1);
 return {status:206,headers:{...headers,'Content-Length':body.length,'Content-Range':`bytes ${start}-${end}/${bytes.length}`},body};
}
