"""Smoke-test a bundled custom character on every available native target."""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--character', default='abrahamlincoln')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    app, out = args.app.resolve(), args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    resources = app / 'Contents/Resources'
    schema = json.loads((resources / 'launch-options.json').read_text())
    build = json.loads((resources / 'build.json').read_text())
    character = next(c for c in build['characters'] if c['slug'] == args.character)
    names = {f['id']: f['label'] for f in schema['fighters']}
    results = []
    for fighter in [character['fighter']] + [v['fighter'] for v in character.get('targets', [])]:
        settings = copy.deepcopy(schema['defaults'])
        settings.update(mode=0, stage=31)
        settings['ports'] = [{'device':'keyboard', 'character':args.character, 'target':fighter},
                             {'device':'cpu', 'character':'vanilla:12'},
                             {'device':'off', 'character':'vanilla:8'},
                             {'device':'off', 'character':'vanilla:8'}]
        path = out / f'target-{fighter}.json'
        path.write_text(json.dumps(settings, indent=2)+'\n')
        start = time.monotonic()
        run = subprocess.run([str(app / 'Contents/MacOS/OpenSmashMelee'),
            '--smoke-test', str(args.rom.resolve()), '--launch-settings', str(path),
            '--user-dir', str(out / 'user')], capture_output=True, text=True, timeout=80)
        log = (out / 'user/game.log').read_text()
        (out / f'target-{fighter}.log').write_text(log)
        result = dict(target=names[fighter], fighter=fighter, passes=run.returncode == 0,
                      seconds=round(time.monotonic()-start,2), output=run.stdout+run.stderr)
        results.append(result)
        (out / 'result.json').write_text(json.dumps(results, indent=2)+'\n')
        print(json.dumps(result), flush=True)
    if not all(r['passes'] for r in results): raise SystemExit('Target smoke test failed')


if __name__ == '__main__': main()
