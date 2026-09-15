"""Reproduce the pinned native runtime; keep game-derived outputs in build/."""
import argparse
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CHECKOUT = ROOT / 'build/browser-engine/meleepad'


def run(*args, cwd=None):
    subprocess.run([str(arg) for arg in args], cwd=cwd, check=True)


def prepare(iso, bootstrap_only=False):
    pins = json.loads((ROOT / 'runtime/upstream.json').read_text())
    upstream = pins['meleepad']
    if not (CHECKOUT / '.git').exists():
        CHECKOUT.parent.mkdir(parents=True, exist_ok=True)
        run('git', 'clone', '--no-checkout', '--filter=blob:none', upstream['url'], CHECKOUT)
        run('git', 'checkout', '--detach', upstream['revision'], cwd=CHECKOUT)
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=CHECKOUT, text=True).strip()
    if actual != upstream['revision']:
        raise ValueError(f'Unexpected checkout revision: {actual}')
    for patch in sorted((ROOT / 'runtime/patches/meleepad').glob('*.patch')):
        reverse = subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)],
                                 cwd=CHECKOUT, capture_output=True)
        if reverse.returncode != 0:
            run('git', 'apply', '--check', patch, cwd=CHECKOUT)
            run('git', 'apply', patch, cwd=CHECKOUT)
    # The upstream verifier hashes the entire image against its reviewed catalog.
    # Do this before cloning dependencies or generating private artifacts.
    identity = subprocess.check_output(
        ['python3', str(CHECKOUT / 'scripts/identify-game.py'), str(iso.resolve())], text=True)
    evidence = ROOT / 'build/moderngekko-validation'
    evidence.mkdir(parents=True, exist_ok=True)
    (evidence / 'image-identity.json').write_text(identity)
    if bootstrap_only:
        run(CHECKOUT / 'scripts/bootstrap-dependencies.sh', cwd=CHECKOUT)
    else:
        run(CHECKOUT / 'scripts/prepare-game.sh', iso.resolve(), cwd=CHECKOUT)
    return json.loads(identity)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('iso', type=Path)
    parser.add_argument('--bootstrap-only', action='store_true')
    args = parser.parse_args()
    print(json.dumps(prepare(args.iso, args.bootstrap_only), indent=2))
