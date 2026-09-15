"""Run serial headed-Chrome checks across all 26 stock fighters and five stages.

Set NODE_PATH for Playwright and MELEE_TEST_URL for the running browser frontend.
Do not build or run other emulator benchmarks concurrently with this check.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MATCHES = [
    ('original', [8, 2, 0, 6], 31),
    ('space-animals-swords', [2, 20, 9, 19], 32),
    ('heavyweights', [5, 1, 4, 13], 2),
    ('climbers-peach-samus-puff', [14, 12, 16, 15], 28),
    ('psychic-transform', [10, 11, 17, 18], 3),
    ('plumbers-swords', [7, 21, 22, 23], 31),
    ('remaining-stock', [3, 24, 25, 0], 32),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('iso', type=Path)
    parser.add_argument('--output', type=Path, default=ROOT / 'build/wasm-roster')
    parser.add_argument('--windows', type=int, default=3)
    args = parser.parse_args()
    if os.environ.get('MELEE_TRACE'):
        parser.error('Run performance validation without MELEE_TRACE')
    if args.windows < 3:
        parser.error('--windows must be at least 3')
    iso = args.iso.resolve(strict=True)
    output = args.output.resolve()
    # Preserve earlier runs instead of mixing fresh results with stale evidence.
    output.mkdir(parents=True, exist_ok=False)
    results = []
    for name, fighters, stage in MATCHES:
        case = output / name
        env = os.environ | {
            'MELEE_LINEUP': 'all-stock', 'MELEE_STAGE': str(stage),
            'MELEE_STOCK_CHARACTERS': ','.join(map(str, fighters)),
            'MELEE_WINDOWS': str(args.windows), 'MELEE_STRICT_WINDOWS': '1',
            'MELEE_REPLAY': '1',
        }
        print(f'Checking {name}: fighters {fighters}, stage {stage}', flush=True)
        with (output / f'{name}.log').open('w') as log:
            run = subprocess.run(
                ['node', str(ROOT / 'tools/validate_local_disc.cjs'), str(iso), str(case), '4'],
                cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
        events = json.loads((case / 'events.json').read_text()) if (case / 'events.json').exists() else []
        windows = [e for e in events if e.get('type') == 'combat-performance']
        session = next((e for e in events if e.get('type') == 'session'), {})
        row = {'name': name, 'fighters': fighters, 'stage': stage,
               'exitCode': run.returncode, 'build': session.get('build'),
               'browser': session.get('browser'), 'windows': windows,
               'replay': (case / 'replay.png').exists()}
        results.append(row)
        (output / 'summary.json').write_text(json.dumps(results, indent=2) + '\n')
        print(f"{name}: exit {run.returncode}, FPS {[round(w['fps'], 2) for w in windows]}", flush=True)
    return 0 if all(r['exitCode'] == 0 and len(r['windows']) == args.windows and r['replay']
                    and all(w.get('profile') == '0' for w in r['windows'])
                    for r in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
