"""Verify bundled stature, stock emblems, and retained weapon geometry against originals."""
import argparse, json, sys
import numpy as np
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.inspect_costume_bounds import rigid_positions
from opensmash_melee.archive import Archive
from opensmash_melee.skeleton import joints
from opensmash_melee.target_presentation import ATTACHMENTS, attachment_transform
from opensmash_melee.presentation import MAGIC, VERSION
TARGETS={0:'captain-falcon',2:'fox',6:'link',7:'luigi',8:'mario',9:'marth'}

def verify(app):
    resources=app/'Contents/Resources';build=json.loads((resources/'build.json').read_text());results=[]
    for character in build['characters']:
        for variant in [character]+character.get('targets',[]):
            costume=variant['costumes'][0];a=Archive.read(resources/costume['path'])
            symbol=next(k for k in a.roots() if k.endswith('_joint'));skeleton=joints(a,symbol)
            m=a.ptr(skeleton[0]['dobj']+8)
            assert a.unpack('II',m+24)==(MAGIC,VERSION)
            scale,offset=a.unpack('2f',m+68);assert .2<scale<3
            emblem=a.ptr(m+80);assert emblem is not None and a.unpack('HHI',emblem+4)==(32,32,6)
            pixels=a.ptr(emblem);raw=a.data[pixels:pixels+4096]
            alpha=bytes(raw[tile+i] for tile in range(0,4096,64) for i in range(0,32,2))
            assert min(alpha)==0 and max(alpha)==255
            original=Archive.read(ROOT/'assets/game/files'/costume['filename']);reference=joints(original,symbol)
            retained=0
            for index in ATTACHMENTS.get(TARGETS[variant['fighter']],[]):
                d=skeleton[index]['dobj'];ref=reference[index]['dobj']
                while ref is not None:
                    assert d is not None
                    p=a.ptr(d+12);q=original.ptr(ref+12)
                    assert p is not None
                    if TARGETS[variant['fighter']] in ('link','marth'):
                        assert a.data[p:p+8]==original.data[q:q+8]
                        assert a.data[p+12:p+16]==original.data[q+12:q+16]
                        assert a.data[p+20:p+24]==original.data[q+20:q+24]
                    else:
                        assert a.data[p:p+24]==original.data[q:q+24]
                    assert a.ptr(d+8)==original.ptr(ref+8) # original weapon material
                    retained+=1;d=a.ptr(d+4);ref=original.ptr(ref+4)
                assert d is None
                if TARGETS[variant['fighter']] in ('link','marth'):
                    original_points=rigid_positions(original,reference[index],unique=False)
                    fitted_points=rigid_positions(a,skeleton[index],unique=False)
                    profile=json.loads((ROOT/'build/characters'/Path(costume['path']).parent.name/'profile.json').read_text())
                    transform=attachment_transform(reference,TARGETS[variant['fighter']],index,profile)
                    expected=(transform@np.c_[original_points,np.ones(len(original_points))].T).T[:,:3]
                    np.testing.assert_allclose(fitted_points,expected,atol=1e-5)
                    # Rotation/translation preserve shape; scale cancels the
                    # body's uniform draw normalization, retaining native size.
                    linear=transform[:3,:3]*scale
                    np.testing.assert_allclose(linear.T@linear,np.eye(3),atol=2e-5)

            clearance={}
            if TARGETS[variant['fighter']]=='marth':
                pose=json.loads((ROOT/'runtime/attachment-poses/marth-idle.json').read_text())
                for index in (19,75,76):
                    points=rigid_positions(a,skeleton[index],pose['visibleDObjs'][str(index)])
                    posed=(np.array(pose['joints'][str(index)])@np.c_[points,np.ones(len(points))].T).T
                    minimum=float((posed[:,1]*scale+offset).min())
                    assert minimum>=.249, f"{character['slug']} Marth joint {index} enters the floor: {minimum}"
                    clearance[str(index)]=minimum
            results.append(dict(character=character['slug'],target=TARGETS[variant['fighter']],scale=scale,offset=offset,retainedAttachmentDObjs=retained,stockEmblem=True,idleWeaponClearance=clearance))
    return dict(passes=True,variants=len(results),results=results)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--app',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=verify(a.app.resolve());a.output.write_text(json.dumps(result,indent=2)+'\n');print(f"PASS: {result['variants']} bundled retargets")
