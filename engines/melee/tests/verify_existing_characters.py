"""Exercise real OpenSmash GLBs against synthetic HSD bind descriptors.

This is an interchange regression, deliberately NOT a Melee gameplay test.
Run: python3 tests/verify_existing_characters.py /path/to/pipeline/play/ui
"""
import json
from pathlib import Path
import sys
import unittest
import numpy as np
from PIL import Image

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from test_pipeline import fixture,decode_vertices
from opensmash_melee.archive import Archive
from opensmash_melee.glb import GLB
from opensmash_melee.skeleton import joints
from opensmash_melee.retarget import conform,skin
from opensmash_melee.gx import replace_costume,batches
from opensmash_melee.__main__ import dump,digest


def verify(path):
    mesh=GLB(path).mesh()
    a=fixture(mesh['bind'])
    s=joints(a,'custom_joint')
    profile=dict(joint_map={name:i for i,name in enumerate(mesh['names'])},mesh_joint=0)
    converted=conform(mesh,s,profile)
    error=float(np.max(np.abs(converted['positions']-mesh['positions'])))
    np.testing.assert_allclose(converted['positions'],mesh['positions'],atol=2e-5,rtol=1e-5)
    converted['image']=mesh['image'].resize((256,256),Image.Resampling.LANCZOS)
    result=replace_costume(a,converted,s,profile)
    raw=a.serialize(); parsed=Archive(raw)
    triangles,used=decode_vertices(parsed,parsed.ptr(s[0]['dobj']+12))
    if len(triangles) != len(mesh['triangles']):
        raise AssertionError('Triangle loss')
    inverse=np.array([j['inverse_bind'] for j in s])
    world=np.linalg.inv(inverse)
    # Deterministic motion applied to each joint, so weighted mixtures are
    # verified independently from the writer and across every exported vertex.
    posed=world.copy()
    for i in range(len(posed)):
        theta=i*.07
        rot=np.eye(4); rot[:2,:2]=[[np.cos(theta),-np.sin(theta)],[np.sin(theta),np.cos(theta)]]
        posed[i]=world[i]@rot
    expected=skin(converted['positions'],converted['envelopes'],posed,inverse)
    lookup={j['offset']:i for i,j in enumerate(s)}
    maximum=0.
    exported_order=[indices for _,tris in batches(converted) for indices in tris]
    for indices,vertices in zip(exported_order,triangles):
        for index,(p,n,uv,env) in zip(indices,vertices):
            actual=np.zeros(3)
            for offset,weight in env:
                joint=lookup[offset]
                actual+=weight*(posed[joint]@inverse[joint]@np.r_[p,1])[:3]
            maximum=max(maximum,float(np.max(np.abs(actual-expected[index]))))
            np.testing.assert_allclose(actual,expected[index],atol=2e-5,rtol=1e-5)
            np.testing.assert_allclose(uv,mesh['uv'][index],atol=1e-6)
    result.update(source_sha256=digest(path),bind_max_abs_error=error,
                  animated_decode_max_abs_error=maximum,archive_bytes=len(raw),
                  fixture_kind='synthetic HSD; source GLB inverse binds, not Melee bones',
                  gameplay_verified=False)
    return result


if __name__=='__main__':
    source=Path(sys.argv[1])
    report={slug:verify(source/slug/'rigged.glb') for slug in ['rowanatkinson','stevejobs','countdracula']}
    dump(Path(__file__).resolve().parents[1]/'build/source-interchange-verification.json',report)
    print(json.dumps(report,indent=2))
