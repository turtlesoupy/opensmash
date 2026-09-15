/* Wait for shader/asset stalls to settle, not for a particular device's FPS.
 * A stable slower device must still be able to enter a match. */
export function sceneReady(intervals) {
  if(intervals.length<30)return false;
  const recent=intervals.slice(-30);
  if(recent.some(ms=>!Number.isFinite(ms)||ms<=0))return false;
  const sorted=recent.toSorted((a,b)=>a-b);
  const median=(sorted[14]+sorted[15])/2;
  if(median>100)return false;
  return sorted[29]<Math.max(40,median*1.75);
}
