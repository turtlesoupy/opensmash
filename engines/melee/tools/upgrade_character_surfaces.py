"""Atomically rebuild cached custom costumes with current surface corrections."""
import argparse
import json
from pathlib import Path
import shutil
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.__main__ import ROOT, atomic_write, digest
from opensmash_melee.surfaces import SURFACE_VERSION, refine_profile
from opensmash_melee.costume_forms import forms_current


def upgrade(ident, library_source=None):
    from opensmash_melee.archive import Archive
    from opensmash_melee.glb import GLB
    from opensmash_melee.skeleton import joints
    from opensmash_melee.retarget import conform
    from opensmash_melee.gx import replace_costume
    from PIL import Image
    if not ident or any(c not in 'abcdefghijklmnopqrstuvwxyz0123456789-_' for c in ident):
        raise ValueError('Invalid character identifier')
    output=ROOT/'build/characters'/ident;profile_path=output/'profile.json'
    old=json.loads(profile_path.read_text())
    if old.get('surface_version',0)>=SURFACE_VERSION:return upgrade_presentation(ident, library_source)
    source=ROOT/'assets/characters'/ident/'rigged.glb'
    if old.get('source_glb_sha256')!=digest(source):raise ValueError('Cached source hash mismatch')
    native=list(output.glob('Pl*Nr.dat'))
    if len(native)!=1:raise ValueError('Expected one neutral native costume')
    original=ROOT/'assets/game/files'/native[0].name
    if old['costume_sha256']!=digest(original):raise ValueError('Original costume hash mismatch')
    archive=Archive.read(original);skeleton=joints(archive,old['symbol']);mesh=GLB(source).mesh()
    profile=refine_profile(mesh,skeleton,old);fitted=conform(mesh,skeleton,profile)
    fitted['image']=fitted['image'].resize((profile['texture_size'],)*2,Image.Resampling.LANCZOS)
    profile_bytes=(json.dumps(profile,indent=2)+'\n').encode()
    import hashlib
    replacements={profile_path:profile_bytes}
    for browser in (False,True):
        path=output/('browser' if browser else '')/native[0].name
        if browser and not path.exists():continue
        if browser:
            from opensmash_melee.browser_skin import build_costume
            raw,stats=build_costume(original.read_bytes(),fitted,skeleton,profile)
        else:
            a=Archive.read(original)
            stats=replace_costume(a,fitted,skeleton,profile);raw=a.serialize()
        stats.update(output_sha256=hashlib.sha256(raw).hexdigest(),output_bytes=len(raw),
                     source_costume_sha256=digest(original),source_glb_sha256=digest(source),
                     profile_sha256=hashlib.sha256(profile_bytes).hexdigest(),surface_version=SURFACE_VERSION,
                     status='requires_gameplay_review')
        replacements[path]=raw
        replacements[path.with_suffix('.dat.json')]=(json.dumps(stats,indent=2)+'\n').encode()
    backup=output/'previous-surfaces'/digest(profile_path)[:16]
    for path in replacements:
        if path.exists():
            saved=backup/path.relative_to(output);saved.parent.mkdir(parents=True,exist_ok=True)
            if not saved.exists():shutil.copy2(path,saved)
    # Commit the profile last. A retry after interruption rebuilds all files.
    for path,raw in replacements.items():
        if path!=profile_path:atomic_write(path,raw)
    atomic_write(profile_path,profile_bytes)
    upgrade_presentation(ident, library_source)
    return True

def upgrade_presentation(ident, library_source=None):
    from opensmash_melee.presentation import panel, import_stencil, VERSION
    import hashlib, os
    character=ROOT/"assets/characters"/ident
    if not (character/"emblem_stencil.png").exists():
        library=Path(os.environ.get("OPENSMASH_CHARACTER_ROOT", ROOT.parents[1]/"play/ui"))
        # Existing imports predate stencil preservation. Match the source art
        # hash, never the retarget/base-fighter name.
        expected=digest(character/"emblem_raw.png")
        direct = Path(library_source)/"emblem_raw.png" if library_source else None
        candidates = ([direct] if direct and direct.is_file() and digest(direct)==expected
                      else sorted(library.glob("*/emblem_raw.png")))
        for source in candidates:
            if digest(source)==expected and import_stencil(source.parent,character):
                manifest_path=character/"manifest.json"
                manifest=json.loads(manifest_path.read_text())
                manifest["files"]["emblem_stencil.png"]=digest(character/"emblem_stencil.png")
                atomic_write(manifest_path,(json.dumps(manifest,indent=2)+"\n").encode())
                break
    changed=False
    output=ROOT/"build/characters"/ident
    profile_path=output/"profile.json"
    profile=json.loads(profile_path.read_text())
    from opensmash_melee.target_presentation import stature, VERSION as STATURE_VERSION
    if profile.get('stature',{}).get('version') != STATURE_VERSION:
        from opensmash_melee.archive import Archive
        from opensmash_melee.glb import GLB
        from opensmash_melee.skeleton import joints
        from opensmash_melee.retarget import conform
        from tools.inspect_costume_bounds import inspect
        original=ROOT/'assets/game/files'/next(output.glob('Pl*Nr.dat')).name
        if digest(original)!=profile['costume_sha256'] or digest(character/'rigged.glb')!=profile['source_glb_sha256']:
            raise ValueError('Stature source hash mismatch')
        skeleton=joints(Archive.read(original),profile['symbol'])
        fitted=conform(GLB(character/'rigged.glb').mesh(),skeleton,profile)
        profile['stature']=stature(fitted,inspect(str(original))[0])
        profile.setdefault('base_fighter','mario')
        atomic_write(profile_path,(json.dumps(profile,indent=2)+'\n').encode())
    if profile.get('base_fighter') in ('link','marth') and profile.get('attachment_version') != 8:
        from opensmash_melee.archive import Archive
        from opensmash_melee.glb import GLB
        from opensmash_melee.skeleton import joints
        from opensmash_melee.retarget import conform
        from opensmash_melee.target_presentation import attachment_offsets, attachment_rotations
        original=ROOT/'assets/game/files'/next(output.glob('Pl*Nr.dat')).name
        skeleton=joints(Archive.read(original),profile['symbol'])
        fitted=conform(GLB(character/'rigged.glb').mesh(),skeleton,profile)
        profile['attachment_scale']=1./profile['stature']['scale']
        profile['attachment_offsets']=attachment_offsets(fitted,skeleton,original,profile['base_fighter'],profile['attachment_scale'])
        profile['attachment_rotations']=attachment_rotations(skeleton,original,profile['base_fighter'],profile['stature'])
        profile['attachment_version']=8
        atomic_write(profile_path,(json.dumps(profile,indent=2)+'\n').encode())
    source_hash=hashlib.sha256((str(VERSION)+digest(profile_path)+digest(character/"character.json")+digest(character/"stock_raw.png")+
        digest(character/("emblem_stencil.png" if (character/"emblem_stencil.png").exists() else "emblem_raw.png"))).encode()).hexdigest()
    fitted=None
    for path in list(output.glob("Pl*Nr.dat"))+list((output/"browser").glob("Pl*Nr.dat")):
        meta=path.with_suffix(".dat.json")
        stats=json.loads(meta.read_text()) if meta.exists() else {}
        if stats.get("presentation_source_sha256")==source_hash and stats.get("output_sha256")==digest(path) and forms_current(stats, profile):continue
        from opensmash_melee.archive import Archive
        from opensmash_melee.skeleton import joints
        from opensmash_melee.glb import GLB
        from opensmash_melee.retarget import conform
        from opensmash_melee.gx import replace_costume
        from PIL import Image
        original=ROOT/"assets/game/files"/path.name
        if digest(original)!=profile["costume_sha256"] or digest(character/"rigged.glb")!=profile["source_glb_sha256"]:
            raise ValueError("Presentation rebuild source hash mismatch")
        archive=Archive.read(original);skeleton=joints(archive,profile["symbol"])
        if fitted is None:
            fitted=conform(GLB(character/"rigged.glb").mesh(),skeleton,profile)
            fitted["image"]=fitted["image"].resize((profile.get("texture_size",512),)*2,Image.Resampling.LANCZOS)
            fitted["presentation"]=panel(character)
        if path.parent.name=="browser":
            from opensmash_melee.browser_skin import build_costume
            raw,stats=build_costume(original.read_bytes(),fitted,skeleton,profile)
        else:
            stats=replace_costume(archive,fitted,skeleton,profile);raw=archive.serialize()
        atomic_write(path,raw);changed=True
        stats.update(presentation_version=VERSION,presentation_source_sha256=source_hash,
                     output_bytes=len(raw),output_sha256=hashlib.sha256(raw).hexdigest(),
                     source_costume_sha256=digest(original),source_glb_sha256=digest(character/"rigged.glb"),
                     profile_sha256=digest(profile_path),surface_version=SURFACE_VERSION)
        atomic_write(meta,(json.dumps(stats,indent=2)+"\n").encode())

    return changed

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('id')
    args=p.parse_args();print('upgraded' if upgrade(args.id) else 'current')
