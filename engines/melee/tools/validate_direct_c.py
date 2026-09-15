"""Bounded source-port combat/scene checks. Writes reproducible evidence, fails closed."""
import argparse,json,math,os,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--iso',type=Path,required=True);p.add_argument('--frames',type=int,default=8000);p.add_argument('--output',type=Path,default=ROOT/'build/direct-c/coverage');p.add_argument('--case',action='append');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 cases=[(f'fighter-{k}',[0,31,9,20,8,k|256,268 if k!=12 else 264,770,777],2) for k in range(26)]
 cases += [(f'stage-{k}',[0,k,9,20,8,264,268,770,777],2) for k in range(2,33) if k not in (21,26)]
 cases += [('four-stock',[0,31,9,20,8,264,258,256,262],4)]
 results=[]
 for name,config,count in cases:
  if a.case and name not in a.case:continue
  start=time.monotonic();run=subprocess.run(['node',str(ROOT/'tools/run_direct_c.mjs'),'--iso',str(a.iso.resolve()),'--frames',str(a.frames),'--fast','--seed','3','--quiet-stubs'],env=dict(os.environ,DIRECT_MATCH=json.dumps(config)),stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=90)
  (a.output/(name+'.log')).write_text(run.stdout);samples=[];exits=[]
  for line in run.stdout.splitlines():
   if line.startswith('{'):
    try:x=json.loads(line)
    except ValueError:continue
    if x.get('type')=='direct-progress' and x.get('sceneKind')==2:samples.append(x)
    if x.get('type')=='direct-exit':exits.append(x)
  valid=[s for s in samples if sum(s['fighters'][i*12]==1 for i in range(4))==count and all(isinstance(x,(int,float)) and math.isfinite(x) for x in s['fighters'])]
  expected=[2,3,1,24,4,5,6,17,0,18,16,8,9,12,10,15,13,14,19,7,22,20,21,26,23,25][config[5]&255]
  identity=any(s['fighters'][1]==expected for s in valid)
  changes=len({tuple(s['fighters']) for s in valid})
  passed=identity and run.returncode==0 and len(valid)>=3 and changes>=3 and exits and exits[-1]['status']==0
  result=dict(case=name,passed=bool(passed),frames=a.frames,combatSamples=len(valid),expectedKind=expected,identityObserved=identity,distinctStates=changes,returncode=run.returncode,seconds=round(time.monotonic()-start,3),launch=config)
  results.append(result);(a.output/'report.json').write_text(json.dumps(results,indent=2));print(json.dumps(result),flush=True)
 return 0 if results and all(r['passed'] for r in results) else 1
if __name__=='__main__':raise SystemExit(main())
