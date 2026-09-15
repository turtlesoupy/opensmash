"""Local CLI. Game-derived outputs stay in ignored build/assets directories."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import sys
from .archive import Archive
from .glb import GLB
from .skeleton import joints
from .retarget import conform
from .gx import replace_costume
from .disc import validate_iso
from .character_assets import portrait_path

ROOT = Path(__file__).resolve().parents[1]
DOL_SHA1 = '08e0bf20134dfcb260699671004527b2d6bb1a45'
UPSTREAM = '64fccd19a0e7c8d54a1da6c56235016b659c354f'


def atomic_write(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent,prefix=path.name+'.')
    try:
        with os.fdopen(fd,'wb') as f:
            f.write(data)
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def dump(path, value):
    atomic_write(path,(json.dumps(value,indent=2)+'\n').encode())


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def import_character(source, out, *, return_mesh=False):
    """Import validated assets; optionally retain the parsed mesh for this build."""
    source, out = Path(source).resolve(),Path(out).resolve()
    if source == out or source in out.parents or out in source.parents:
        raise ValueError('Import destination must be separate from its source')
    if out.exists():
        raise ValueError('Import destination already exists')
    required = ['character.json','rigged.glb',portrait_path(source).name,'stock_raw.png','emblem_raw.png','announcer.wav']
    for name in required:
        if not (source/name).is_file():
            raise ValueError(f'Missing generation artifact: {name}')
    mesh = GLB(source/'rigged.glb').mesh()
    character = json.loads((source/'character.json').read_text())
    out.parent.mkdir(parents=True,exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.character-',dir=out.parent))
    try:
        for name in required:
            shutil.copy2(source/name,staging/name)
        from .presentation import import_stencil
        if import_stencil(source, staging): required.append("emblem_stencil.png")
        manifest = dict(schema=1,character=character,
                        files={name:digest(staging/name) for name in required},
                        mesh=dict(vertices=len(mesh['positions']),triangles=len(mesh['triangles']),
                                  joints=mesh['names']),
                        runtime_status='not_integrated',source_kind='opensmash-generation')
        dump(staging/'manifest.json',manifest)
        staging.rename(out)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return (manifest, mesh) if return_mesh else manifest


def doctor():
    melee = ROOT/'melee'
    dol = melee/'orig/GALE01/sys/main.dol'
    original = hashlib.sha1(dol.read_bytes()).hexdigest() if dol.exists() else None
    built = next((p for p in (melee/'build/GALE01/main.dol',ROOT/'build/engine-linux/build/GALE01/main.dol') if p.exists()),melee/'build/GALE01/main.dol')
    built_sha1 = hashlib.sha1(built.read_bytes()).hexdigest() if built.exists() else None
    rev = subprocess.check_output(['git','rev-parse','HEAD'],cwd=melee,text=True).strip() if (melee/'.git').exists() else None
    return dict(upstream_commit=rev,pinned_commit=UPSTREAM,pin_matches=rev==UPSTREAM,
                original_dol_sha1=original,original_dol_matches=original==DOL_SHA1,
                ninja=shutil.which('ninja'),wine=shutil.which('wine'),
                built_dol_sha1=built_sha1,
                matching_build_verified=original==DOL_SHA1 and built_sha1==DOL_SHA1,
                gameplay_verified=False,parity_verified=False)


def prepare_game(source):
    source = Path(source).resolve()
    target = ROOT/'assets/game'
    if target.exists():
        raise ValueError('assets/game already exists; use a fresh destination/project')
    if not source.exists():
        raise ValueError('Game source does not exist')
    if source.is_file() and source.suffix.lower() in ('.iso','.gcm'):
        verification=validate_iso(source)
        dump(ROOT/'build/disc-validation.json',verification)
        if not verification['valid_for_project']:
            raise ValueError('Disc does not match the published unmodified Melee 1.02 MD5')
    target.parent.mkdir(parents=True,exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.game-',dir=target.parent))
    try:
        if source.is_dir():
            shutil.copytree(source,staging,dirs_exist_ok=True)
        else:
            dtk = ROOT/'melee/build/tools/dtk'
            if not dtk.exists():
                raise ValueError('Run upstream configure.py and ninja to provision decomp-toolkit first')
            subprocess.run([str(dtk),'disc','extract','--quiet',str(source),str(staging)],check=True)
        dol = staging/'sys/main.dol'
        if not dol.is_file() or hashlib.sha1(dol.read_bytes()).hexdigest() != DOL_SHA1:
            raise ValueError('Expected unmodified Melee NTSC-U 1.02 main.dol')
        boot = staging/'sys/boot.bin'
        if not boot.is_file() or boot.read_bytes()[:6] != b'GALE01':
            raise ValueError('Missing or incorrect GALE01 boot.bin')
        original = ROOT/'melee/orig/GALE01/sys/main.dol'
        if original.exists() and original.read_bytes() != dol.read_bytes():
            raise ValueError('Upstream original main.dol differs; refusing to replace it')
        atomic_write(original,dol.read_bytes())
        staging.rename(target)
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return dict(game=str(target),dol_sha1=DOL_SHA1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command',required=True)
    sub.add_parser('doctor')
    p = sub.add_parser('validate-disc')
    p.add_argument('source')
    p = sub.add_parser('prepare-game')
    p.add_argument('source',help='User-provided ISO/RVZ or extracted sys/ and files/ directory')
    sub.add_parser('build-engine')
    p = sub.add_parser('import-character')
    p.add_argument('source')
    p.add_argument('output')
    p = sub.add_parser('inspect-dat')
    p.add_argument('dat')
    p.add_argument('--symbol')
    p.add_argument('--out')
    p = sub.add_parser('convert')
    p.add_argument('character',help='Imported character directory')
    p.add_argument('--costume',required=True)
    p.add_argument('--profile',required=True)
    p.add_argument('--out',required=True)
    args = parser.parse_args()
    if args.command == 'doctor':
        result = doctor()
    elif args.command == 'validate-disc':
        result=validate_iso(args.source)
        dump(ROOT/'build/disc-validation.json',result)
        if not result['valid_for_project']:
            print(json.dumps(result,indent=2))
            raise ValueError('Disc does not match the published unmodified Melee 1.02 MD5')
    elif args.command == 'prepare-game':
        result = prepare_game(args.source)
    elif args.command == 'build-engine':
        if not doctor()['original_dol_matches']:
            raise ValueError('Run prepare-game with Melee NTSC-U 1.02 first')
        subprocess.run([sys.executable,'configure.py'],cwd=ROOT/'melee',check=True)
        subprocess.run(['ninja'],cwd=ROOT/'melee',check=True)
        output = ROOT/'melee/build/GALE01/main.dol'
        matched = output.exists() and hashlib.sha1(output.read_bytes()).hexdigest() == DOL_SHA1
        if not matched:
            raise ValueError('Built main.dol does not match the reference SHA-1')
        result = dict(matching_build_verified=True,sha1=DOL_SHA1)
        dump(ROOT/'build/engine-verification.json',result)
    elif args.command == 'import-character':
        result = import_character(args.source,args.output)
    elif args.command == 'inspect-dat':
        archive = Archive.read(args.dat)
        result = dict(symbols=archive.roots())
        if args.symbol:
            result['joints'] = joints(archive,args.symbol)
        if args.out:
            dump(args.out,result)
    else:
        if Path(args.out).resolve() == Path(args.costume).resolve():
            raise ValueError('Output must not overwrite the source costume')
        character = Path(args.character)
        manifest = json.loads((character/'manifest.json').read_text())
        for name,sha in manifest['files'].items():
            if not re.fullmatch(r'[A-Za-z0-9_.-]+',name) or digest(character/name) != sha:
                raise ValueError('Imported character hash mismatch')
        profile = json.loads(Path(args.profile).read_text())
        if profile.get('costume_sha256') != digest(args.costume):
            raise ValueError('Profile must pin the exact source costume SHA-256')
        if profile.get('source_glb_sha256') and profile['source_glb_sha256']!=digest(character/'rigged.glb'):
            raise ValueError('Character-specific fit profile does not match source GLB')
        archive = Archive.read(args.costume)
        skeleton = joints(archive,profile['symbol'])
        mesh = conform(GLB(character/'rigged.glb').mesh(),skeleton,profile)
        size = profile.get('texture_size',256)
        if type(size) is not int or size < 4 or size > 1024 or size & (size-1):
            raise ValueError('texture_size must be a power of two from 4 to 1024')
        from PIL import Image
        mesh['image'] = mesh['image'].resize((size,size),Image.Resampling.LANCZOS)
        from .presentation import panel
        mesh["presentation"] = panel(character)
        result = replace_costume(archive,mesh,skeleton,profile)
        raw = archive.serialize()
        atomic_write(args.out,raw)
        result.update(status='experimental_unverified_in_game',source_costume_sha256=digest(args.costume),
                      source_glb_sha256=digest(character/'rigged.glb'),profile_sha256=digest(args.profile),
                      output_sha256=hashlib.sha256(raw).hexdigest(),output_bytes=len(raw))
        dump(str(args.out)+'.json',result)
    print(json.dumps(result,indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError,KeyError,OSError,subprocess.CalledProcessError) as exc:
        sys.exit(f'Error: {exc}')
