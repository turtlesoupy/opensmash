"""Exercise launch destinations, input, custom results and repeat-match transitions."""
import argparse,json,os,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--iso',type=Path,required=True);p.add_argument('--output',type=Path,default=ROOT/'build/direct-c/flows');p.add_argument('--fixture',type=Path,default=ROOT/'build/direct-c/four-fixture');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 results=[]
 cases=[('vs-menu',1,1200,['--autoplay'],[1]),('character-select',2,6000,['--autoplay','--kill','1@1200/100'],[8,9,2,5,8,9,2]),('classic',3,3600,['--autoplay'],[8,32,2]),('full-boot',4,1800,['--autoplay'],[28,0,1,8]),('custom-results',0,3600,['--kill','1,2,3@1500/100'],[2,5]),('input-idle',0,1500,[],[2]),('input-right',0,1500,[],[2])]
 samples={}
 for name,mode,frames,args,expected in cases:
  config=[mode,31,9,1,8,8,268,770,777]
  if name=='custom-results':config=[0,31,9,1,8,8,258,65800,131336]
  env=dict(os.environ,DIRECT_MATCH=json.dumps(config))
  if name=='input-right':env['DIRECT_INPUTS']=json.dumps([[1,300,0,0,80,0,0,0,0,0,1],[301,1500,0,0,0,0,0,0,0,0,1]])
  if name in ('character-select','custom-results'):
   if not a.fixture.is_dir():raise RuntimeError('Prepare the four-character fixture before custom flow checks')
   args+=['--mod',str(a.fixture.resolve())]
  run=subprocess.run(['node',str(ROOT/'tools/run_direct_c.mjs'),'--iso',str(a.iso.resolve()),'--frames',str(frames),'--seed','3','--quiet-stubs','--saves',str(a.output/'saves'),*args],env=env,capture_output=True,text=True,timeout=240)
  log=run.stdout+run.stderr;(a.output/(name+'.log')).write_text(log)
  scenes=[int(x) for x in re.findall(r'\[pc\] scene:.*?scene_kind (\d+)',log)]
  it=iter(scenes);sequence=all(any(actual==want for actual in it) for want in expected)
  records=[json.loads(line) for line in run.stdout.splitlines() if line.startswith('{')]
  samples[name]=[r['fighters'] for r in records if r.get('type')=='direct-progress' and r.get('sceneKind')==2]
  errors=[]
  if run.returncode or not any(r.get('type')=='direct-exit' and r['status']==0 for r in records):errors.append('Runtime did not exit cleanly')
  if not sequence:errors.append(f'Missing scene sequence {expected}')
  if name in ('character-select','custom-results') and 'results identity port=0' not in log:errors.append('Custom result identity was not applied')
  if name=='input-right' and samples[name]==samples.get('input-idle'):errors.append('Controller input did not change fighter state')
  result=dict(case=name,passed=not errors,scenes=scenes,errors=errors);results.append(result);print(json.dumps(result),flush=True);(a.output/'report.json').write_text(json.dumps(results,indent=2))
 return int(any(not r['passed'] for r in results))
if __name__=='__main__':raise SystemExit(main())
