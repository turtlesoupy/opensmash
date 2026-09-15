"""Exercise all five launch destinations and a mixed four-player custom lineup."""
import argparse
import json
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    app = args.app.resolve()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    executable = app / 'Contents/MacOS/OpenSmashMelee'
    resources = app / 'Contents/Resources'
    schema = json.loads((resources / 'launch-options.json').read_text())
    build = json.loads((resources / 'build.json').read_text())
    custom = build['characters']
    cases = [(m['key'], {'mode':m['id']}) for m in schema['modes']]
    # Include a standard Mario and two custom characters sharing Falcon's slots.
    wanted = ['alanturing', 'abrahamlincoln', 'achilles']
    available = {c['slug'] for c in custom}
    if set(wanted) <= available:
        cases.append(('four-player-costumes', {'mode':0, 'stage':32, 'level':9,
            'ports':[{'device':d,'character':c} for d,c in zip(
                ['keyboard','cpu','cpu','cpu'], [wanted[0],wanted[1],'vanilla:8',wanted[2]])]}))
    results=[]
    for name, overrides in cases:
        settings = schema['defaults'] | overrides
        settings_path = out / (name+'.json')
        settings_path.write_text(json.dumps(settings, indent=2)+'\n')
        start=time.monotonic()
        run=subprocess.run([str(executable),'--smoke-test',str(args.rom.resolve()),
            '--user-dir',str(out/'user'),'--launch-settings',str(settings_path),
            '--character',custom[0]['slug'] if custom else 'vanilla:8'],
            capture_output=True,text=True,timeout=80)
        log=(out/'user/game.log').read_text()
        (out/(name+'.log')).write_text(log)
        result=dict(case=name, passes=run.returncode==0, seconds=round(time.monotonic()-start,2),
                    output=run.stdout+run.stderr)
        results.append(result)
        (out/'result.json').write_text(json.dumps(results,indent=2)+'\n')
        print(json.dumps(result),flush=True)
    if not all(r['passes'] for r in results):
        raise SystemExit('Launch destination validation failed; inspect the logs.')

if __name__=='__main__':
    main()
