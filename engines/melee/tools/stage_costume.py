"""Stage a separate Dolphin folder boot with a converted costume."""
import argparse
import json
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.__main__ import digest,dump,DOL_SHA1
import hashlib


def stage(game,costume,output,filename,dol=None):
    game,costume,output=Path(game).resolve(),Path(costume).resolve(),Path(output).resolve()
    if output==game or game in output.parents or output in game.parents or output.exists():
        raise ValueError('Output must be a new directory separate from the original game')
    if Path(filename).name!=filename or not (game/'files'/filename).is_file():
        raise ValueError('Expected an existing root-level game costume filename')
    if hashlib.sha1((game/'sys/main.dol').read_bytes()).hexdigest()!=DOL_SHA1:
        raise ValueError('Original game DOL is not the validated 1.02 executable')
    if dol is not None:
        dol=Path(dol).resolve()
        if hashlib.sha1(dol.read_bytes()).hexdigest()!=DOL_SHA1:
            raise ValueError('Built executable does not match the verified baseline')
    original,patched=Archive.read(game/'files'/filename),Archive.read(costume)
    symbols=[name for name in original.roots() if name.endswith('_joint') and 'matanim' not in name]
    if len(symbols)!=1:
        raise ValueError('Expected one costume joint root')
    a,b=joints(original,symbols[0]),joints(patched,symbols[0])
    for key in ('index','offset','parent','rotation','scale','position','inverse_bind','dobj'):
        if [j[key] for j in a]!=[j[key] for j in b]:
            raise ValueError('Converted costume changed original skeleton '+key)
    shutil.copytree(game,output)
    if dol is not None:shutil.copy2(dol,output/'sys/main.dol')
    shutil.copy2(costume,output/'files'/filename)
    report=dict(status='staged_not_gameplay_verified',filename=filename,
                source_costume_sha256=digest(game/'files'/filename),
                staged_costume_sha256=digest(output/'files'/filename),
                boot=str(output/'sys/main.dol'),executable_source=str(dol or game/'sys/main.dol'),executable_sha1=DOL_SHA1)
    dump(output.parent/'staged-game.json',report)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('game');p.add_argument('costume');p.add_argument('output')
    p.add_argument('--filename',default='PlMrNr.dat')
    p.add_argument('--dol',help='Verified decomp build main.dol to use')
    args=p.parse_args()
    print(json.dumps(stage(args.game,args.costume,args.output,args.filename,args.dol),indent=2))
