"""Build all target choices for locally cached roster characters."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from opensmash_melee.targets import BY_SLUG as TARGETS, cache_id


def build(slugs=None):
    catalog = json.loads((ROOT / 'web/public/catalog.json').read_text())
    for row in catalog:
        base = 'web-v1-' + hashlib.sha256(row['slug'].encode()).hexdigest()[:16]
        if slugs and row['slug'] not in slugs: continue
        if not (ROOT / 'build/characters' / base / 'profile.json').exists(): continue
        for target in TARGETS:
            if target == row.get('original_target', row['target']): continue
            ident = cache_id(row['slug'],target,row.get('original_target', row['target']))
            folder = ROOT / 'build/characters' / ident
            filename = TARGETS[target]['costumes'][0]['filename']
            if not (folder / filename).exists():
                subprocess.run([sys.executable, str(ROOT / 'tools/build_character.py'),
                    str(ROOT / 'assets/characters' / base), '--id', ident, '--target', target], check=True, cwd=ROOT)
            subprocess.run([sys.executable, str(ROOT / 'tools/upgrade_character_surfaces.py'), ident], check=True, cwd=ROOT)
            if not (folder / 'browser' / filename).exists():
                subprocess.run([sys.executable, str(ROOT / 'tools/build_browser_skin_costume.py'), ident], check=True, cwd=ROOT)
            (folder / 'retarget.json').write_text(json.dumps({'slug': row['slug'], 'target': target}) + '\n')
            print(row['slug'], target, 'ready', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('slugs', nargs='*', help='Default: all locally cached roster characters')
    build(parser.parse_args().slugs)
