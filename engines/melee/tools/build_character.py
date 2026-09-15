"""Import, fit and build an existing OpenSmash character as a Melee costume."""
import argparse
from pathlib import Path
import re
import subprocess
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from opensmash_melee.__main__ import ROOT, import_character, dump
from tools.fit_mario_profile import fit
from tools.stage_costume import stage
from opensmash_melee.multi_fighter import TARGETS as STABLE_TARGETS, load_target, fit as fit_target
from opensmash_melee.retarget_probe import TARGETS as ROSTER_TARGETS
TARGETS = {slug:(code,kind,slug) for slug,code,kind in ROSTER_TARGETS}


from opensmash_melee.surfaces import smoothing_scope

@smoothing_scope()
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('source',type=Path,help='Original generation directory with rigged.glb and presentation assets')
    p.add_argument('--id',required=True,help='New local character identifier')
    p.add_argument('--stage',action='store_true',help='Also create a separate bootable game directory')
    p.add_argument('--target',choices=TARGETS,default='mario',help='Melee moveset to use in the actual game')
    p.add_argument('--head-style',choices=['source','uniform'],default='source')
    p.add_argument('--prepare-web',action='store_true',help='Reuse fitting and artwork for native/browser outputs')
    p.add_argument('--compact',action='store_true')
    a=p.parse_args()
    if not re.fullmatch('[a-z0-9][a-z0-9_-]{0,63}',a.id):p.error('Use a lowercase identifier, at most 64 characters')
    imported=ROOT/'assets/characters'/a.id;out=ROOT/'build/characters'/a.id
    if imported.exists() or out.exists():p.error('Identifier already exists; choose a new revision identifier')
    filename=f'Pl{TARGETS[a.target][0]}Nr.dat'
    costume=ROOT/'assets/game/files'/filename
    if not costume.exists():p.error('Prepare the validated game first')
    if a.target!='mario' and a.head_style!='source':
        p.error('Other fighters currently use source head proportions')
    _, mesh = import_character(a.source,imported,return_mesh=True)
    from opensmash_melee.archive import Archive
    from opensmash_melee.skeleton import joints
    from opensmash_melee.retarget import conform
    from tools.validate_shape import shape_metrics
    fitted=None
    if a.target=='mario':
        profile=fit(imported,costume,a.head_style)
    elif a.target not in STABLE_TARGETS:
        from opensmash_melee.roster_fit import profile_for
        from opensmash_melee.__main__ import digest
        profile,fitted=profile_for(mesh, ROOT/'assets/game/files', a.target, return_fitted=True)
        profile.update(costume_sha256=digest(costume),source_glb_sha256=digest(imported/'rigged.glb'),status='requires_gameplay_review')
    else:
        from opensmash_melee.__main__ import digest
        target=load_target(ROOT/'assets/game/files',a.target)
        profile=fit_target(mesh,target)
        profile.update(symbol=target['symbol'],costume_sha256=digest(costume),
                       source_glb_sha256=digest(imported/'rigged.glb'),
                       mesh_joint=0,mesh_dobj=0,
                       head_style='source',fit_version=6,
                       status='requires_gameplay_review')
    skeleton=joints(Archive.read(costume),profile['symbol'])
    if fitted is None:fitted=conform(mesh,skeleton,profile)
    shape=shape_metrics(mesh,fitted,profile,skeleton)
    dump(out/'shape.json',shape)
    if not profile.get('ball_fit') and (shape['head_anisotropy']>1.03 or shape['similarity_max_relative_error']>.025
        or (a.head_style=='source' and shape['head_fraction_relative_error']>.05)):
        p.error('Source-shape check needs manual review; see '+str(out/'shape.json'))
    dump(out/'profile.json',profile)
    # Existing special attachment/stature migrations retain their established path.
    from opensmash_melee.target_presentation import VERSION as STATURE_VERSION
    from opensmash_melee.surfaces import SURFACE_VERSION
    if a.prepare_web and profile.get('surface_version',0) >= SURFACE_VERSION and profile.get('stature',{}).get('version') == STATURE_VERSION and profile.get('base_fighter') not in ('link','marth'):
        import hashlib
        from PIL import Image
        from opensmash_melee.__main__ import atomic_write, digest
        from opensmash_melee.presentation import panel, VERSION
        from opensmash_melee.gx import replace_costume
        from opensmash_melee.surfaces import SURFACE_VERSION
        original=costume.read_bytes()
        fitted['presentation']=panel(imported)
        size=profile.get('texture_size',256)
        if type(size) is not int or size < 4 or size > 1024 or size & (size-1):
            raise ValueError('Invalid texture size')
        native=dict(fitted,image=fitted['image'].resize((size,size),Image.Resampling.LANCZOS))
        archive=Archive(original)
        stats=replace_costume(archive,native,skeleton,profile)
        raw=archive.serialize()
        source_hash=hashlib.sha256((str(VERSION)+digest(out/'profile.json')+digest(imported/'character.json')+digest(imported/'stock_raw.png')+
            digest(imported/('emblem_stencil.png' if (imported/'emblem_stencil.png').exists() else 'emblem_raw.png'))).encode()).hexdigest()
        stats.update(presentation_version=VERSION,presentation_source_sha256=source_hash,
                     output_bytes=len(raw),output_sha256=hashlib.sha256(raw).hexdigest(),
                     source_costume_sha256=digest(costume),source_glb_sha256=digest(imported/'rigged.glb'),
                     profile_sha256=digest(out/'profile.json'),surface_version=SURFACE_VERSION,
                     status='requires_gameplay_review')
        atomic_write(out/filename,raw);dump(str(out/filename)+'.json',stats)
        from tools.build_browser_skin_costume import build
        build(a.id,a.compact,prepared=(original,skeleton,fitted))
        if not a.compact:
            import json
            browser=out/'browser'/filename
            browser_stats=json.loads((browser.parent/'stats.json').read_text())
            browser_stats.update({key:value for key,value in stats.items() if key in (
                'presentation_version','presentation_source_sha256','source_costume_sha256',
                'source_glb_sha256','profile_sha256','surface_version','status')})
            browser_stats.update(output_bytes=browser.stat().st_size,output_sha256=digest(browser))
            dump(str(browser)+'.json',browser_stats)
    else:
        subprocess.run([sys.executable,'-m','opensmash_melee','convert',str(imported),
                        '--costume',str(costume),'--profile',str(out/'profile.json'),
                        '--out',str(out/filename)],cwd=ROOT,check=True)
    if a.stage:
        dol=ROOT/'build/engine-linux/build/GALE01/main.dol'
        stage(ROOT/'assets/game',out/filename,out/'game',filename,dol)
        print('Launch: python3 tools/launch_dolphin.py '+str(out/'game/sys/main.dol'))
    print('Built experimental character: '+str(out))
    print('This build requires in-game review; build success is not a parity certificate.')


if __name__=='__main__':main()
