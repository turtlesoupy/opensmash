"""Build portable, moveset-independent Melee source assets.

Used by character generation, and by --all for a bounded, resumable bulk bake.
The local launcher uses the same preparation function to fill missing sources.
No game files or Nintendo assets are read or included in these packages.
"""
import argparse,json,shutil,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.native_source import prepare


def bake(source):
    source=source.resolve();slug=source.name
    result=prepare(ROOT,source,slug)
    directory=ROOT/'build/native-fit/local/revisions'/result['base'].split('/')[-3]
    for suffix in ('.json','.rgba8','.identity.dat'):
        shutil.copyfile(directory/'sources'/f'{slug}{suffix}',source/f'melee-source{suffix}')
    # Receipt last: interrupted copies never count as a completed package.
    temporary=source/'melee-source-ready.json.tmp'
    temporary.write_text((directory/'ready.json').read_text())
    temporary.replace(source/'melee-source-ready.json')
    print(json.dumps({'character':slug,'reused':result['cached'],'milliseconds':result['sourcePreparationMs']}),flush=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('sources',nargs='*',type=Path)
    p.add_argument('--all',action='store_true',help='Bake all local sources sequentially; completed sources are reused')
    p.add_argument('--source-root',type=Path,default=ROOT.parents[1]/'play/ui')
    args=p.parse_args();sources=args.sources
    if args.all:sources+=sorted(path.parent for path in args.source_root.glob('*/rigged.glb'))
    if not sources:p.error('Provide source directories or --all')
    failures=[]
    for source in dict.fromkeys(sources):
        try:bake(source)
        except (ValueError,OSError) as error:
            failures.append(str(source));print(f'{source}: {error}',file=sys.stderr,flush=True)
    if failures:raise SystemExit(f'{len(failures)} sources failed; rerun after fixing their input assets.')

if __name__=='__main__':main()
