"""Build the roster-wide anatomical fit using the inspected target mappings."""
import numpy as np
from .retarget_probe import TARGETS, load
from .multi_fighter import fit
from .proportions import source_head_fit
from .retarget import conform
from .target_presentation import stature

def profile_for(mesh, game, slug, *, return_fitted=False):
    from tools.inspect_costume_bounds import inspect
    spec = next(s for s in TARGETS if s[0] == slug)
    target = load(game, spec)
    original, _ = inspect(str(game / ('Pl' + spec[1] + 'Nr.dat')))
    target['original_bounds'] = [original.min(0).tolist(), original.max(0).tolist()]
    profile, fitted = source_head_fit(mesh, target['skeleton'], fit(mesh, target), return_fitted=True)
    if slug in ('kirby', 'jigglypuff'):
        from tools.fit_ball_hands import fit_hands
        profile.update(ball_fit={'version': 1, 'radius': 4.3 if slug == 'kirby' else 4.5}, head_style='ball')
        import gzip, json, hashlib
        from pathlib import Path
        calibration = json.loads(gzip.decompress((Path(__file__).resolve().parents[1] / 'runtime/retarget-clearance' / (slug+'.json.gz')).read_bytes()))
        if calibration['costume_sha256'] != hashlib.sha256((game / ('Pl'+spec[1]+'Nr.dat')).read_bytes()).hexdigest():
            raise ValueError('Hand clearance calibration does not match the verified costume')
        profile = fit_hands(mesh, target['skeleton'], profile, calibration['samples'])
        fitted = conform(mesh, target['skeleton'], profile)
    profile.update(symbol=target['symbol'], base_fighter=slug, mesh_joint=0,
                   mesh_dobj=6 if slug == 'kirby' else 0,
                   stature={'scale':1.0,'offset':0.0,'version':1} if profile.get('ball_fit') else stature(fitted, original),
                   isolate_body_texture_animation=True)
    gear = {'popo':[15], 'nana':[15], 'roy':[21,77,78], 'young-link':[27,28,71,73,74,75]}
    if slug in gear:
        profile.update(preserve_attachment_joints=gear[slug], attachment_scale=1/profile['stature']['scale'],
                       attachment_anchors={'78':77} if slug=='roy' else {'28':27,'74':73,'75':73} if slug=='young-link' else {})
    return (profile, fitted) if return_fitted else profile
