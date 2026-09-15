"""Exercise production fitting/export for a hat and hatless source on every target."""
import sys,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.targets import BY_SLUG

def main():
    out=ROOT/'build/roster-integration';out.mkdir(exist_ok=True);rows=[]
    for source in ['alanturing','abrahamlincoln']:
        for target in BY_SLUG:
            ident=f'roster-v1-{source}-{target}'
            log=out/(ident+'.log');ok=True
            steps=[]
            if not (ROOT/'build/characters'/ident/'profile.json').exists():
                steps.append(['tools/build_character.py',str(ROOT.parents[1]/'play/ui'/source),'--id',ident,'--target',target])
            steps += [['tools/upgrade_character_surfaces.py',ident],['tools/build_browser_skin_costume.py',ident]]
            with log.open('w') as f:
                for step in steps:
                    p=subprocess.run([sys.executable,*step],cwd=ROOT,stdout=f,stderr=subprocess.STDOUT)
                    if p.returncode:ok=False;break
            rows.append(dict(source=source,target=target,ident=ident,passed=ok));(out/'report.json').write_text(json.dumps(rows,indent=2)+'\n')
            print(source,target,'PASS' if ok else 'FAIL',flush=True)
    return 0 if all(r['passed'] for r in rows) else 1
if __name__=='__main__':sys.exit(main())
