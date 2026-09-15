"""Compare direct-C and the existing browser backend with the same launcher workload.

Run without other games/builds active. Each case uses a fresh Chrome profile and
three 30-second combat windows; the existing 60-FPS/audio gate is retained.
"""
import argparse,json,os,subprocess,sys,threading,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def compiler_processes():
 text=subprocess.check_output(['ps','-Ao','pid,pcpu,comm'],text=True)
 return [line.strip() for line in text.splitlines() if any(name in line for name in ['/wasm-opt','/wasm-emscripten-finalize','/clang','/emcc','/em++','/wasm-ld'])]
def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--iso',type=Path,required=True);p.add_argument('--url',default='http://127.0.0.1:5189/');p.add_argument('--output',type=Path,default=ROOT/'build/direct-c/benchmarks');p.add_argument('--case',action='append');p.add_argument('--wait-for-compilers',action='store_true',help='Require 20 seconds without Emscripten compiler processes before each case');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True);results=[]
 for backend,players,lineup in [('direct',2,'stock'),('ppc',2,'stock'),('direct',4,'custom'),('ppc',4,'custom')]:
  name=f'{backend}-{players}'
  if a.case and name not in a.case:continue
  if a.wait_for_compilers:
   quiet=0
   while quiet<4:
    active=compiler_processes();quiet=0 if active else quiet+1;time.sleep(5)
  out=a.output/name;out.mkdir(parents=True,exist_ok=True)
  env=dict(os.environ,NODE_PATH=str(ROOT/'build/test-tools/node_modules'),MELEE_TEST_URL=a.url+('?engine=direct-c&benchmark=1' if backend=='direct' else '?benchmark=1'),MELEE_WINDOWS='3',MELEE_LINEUP=lineup)
  if players==2:env['MELEE_REPLAY']='1'
  with (out/'host-processes.txt').open('w') as f:subprocess.run(['ps','-Ao','pid,pcpu,comm'],stdout=f,check=True)
  activity=[];stop=threading.Event()
  def monitor():
   while not stop.is_set():
    activity.append(dict(time=time.time(),compilers=compiler_processes()));stop.wait(5)
  watcher=threading.Thread(target=monitor,daemon=True);watcher.start()
  with (out/'console.log').open('w') as log:
   run=subprocess.run(['node',str(ROOT/'tools/validate_local_disc.cjs'),str(a.iso.resolve()),str(out),str(players)],env=env,stdout=log,stderr=subprocess.STDOUT)
  stop.set();watcher.join();(out/'compiler-activity.json').write_text(json.dumps(activity,indent=2))
  events=json.loads((out/'events.json').read_text()) if (out/'events.json').exists() else []
  windows=[e for e in events if e.get('type')=='combat-performance']
  result=dict(case=name,compilerContention=any(x['compilers'] for x in activity),gatePassed=run.returncode==0,returncode=run.returncode,windows=windows,errors=json.loads((out/'errors.json').read_text()) if (out/'errors.json').exists() else ['No report']);results.append(result);print(json.dumps(result),flush=True);(a.output/'report.json').write_text(json.dumps(results,indent=2))
 return int(not results or any(not r['gatePassed'] for r in results))
if __name__=='__main__':sys.exit(main())
