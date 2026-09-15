/* A loading barrier must reject stalls, even when their average looks fast. */
export function sceneReady(intervals) {
  if(intervals.length<30)return false;
  const recent=intervals.slice(-30);
  return recent.every(ms=>Number.isFinite(ms)&&ms>0&&ms<40) &&
    recent.reduce((sum,ms)=>sum+ms,0)/recent.length<20;
}
