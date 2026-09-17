"""Verify browser costume geometry and presentation against independent Python rules."""
import argparse,json,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.archive import Archive
from opensmash_melee.targets import BY_SLUG
from opensmash_melee.retarget_probe import TARGETS,load
from opensmash_melee.target_presentation import stature,attachment_offsets,attachment_rotations,attachment_transform
from opensmash_melee.costume_forms import form_joints
from tools.inspect_costume_bounds import inspect


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--character',default='barackobama');args=p.parse_args();count=0
    for slug,spec in BY_SLUG.items():
        target=json.loads((ROOT/'build/native-fit/local/targets'/f'{slug}.json').read_text())
        fixture=json.loads((ROOT/'build/native-fit/fixtures'/f'{args.character}-{slug}.json').read_text())
        n=fixture['n'];slots=5 if target['mode']=='round' else 4
        envs=[tuple((j,w) for j,w in zip(fixture['expectedJoints'][i*slots:(i+1)*slots],fixture['expectedWeights'][i*slots:(i+1)*slots]) if j!=4294967295) for i in range(n)]
        fitted={'positions':np.array(fixture['expectedPositions']).reshape(-1,3),'envelopes':envs}
        original=ROOT/'assets/game/files'/spec['costumes'][0]['filename'];rig=load(original.parent,next(t for t in TARGETS if t[0]==slug))
        fit={'scale':1.,'offset':0.} if target['mode']=='round' else stature(fitted,inspect(str(original))[0])
        profile={'base_fighter':slug,'stature':fit,'attachment_scale':1/fit['scale'],
                 'attachment_anchors':{'78':77} if slug=='roy' else {'28':27,'74':73,'75':73} if slug=='young-link' else {}}
        profile['attachment_offsets']=attachment_offsets(fitted,rig['skeleton'],original,slug,profile['attachment_scale'])
        profile['attachment_rotations']=attachment_rotations(rig['skeleton'],original,slug,fit)
        for color,layout in enumerate(target['layouts']):
            path=ROOT/'build/native-fit/roster-validation'/f'{args.character}-{slug}-{color}.dat';a=Archive.read(path)
            pobj=a.ptr(layout['dobj']+12);desc=a.ptr(pobj+8);meta=a.ptr(desc+116)
            assert a.u32(meta+8)==n
            for name,field in [('expectedPositions',20),('expectedNormals',24)]:
                actual=np.frombuffer(a.data,dtype='>f4',count=n*3,offset=a.ptr(meta+field))
                assert np.array_equal(actual,np.asarray(fixture[name],dtype=np.float32)),(slug,color,name)
            table=a.ptr(pobj+20);bone_desc=a.ptr(table)
            bones=[layout['jointOffsets'].index(a.ptr(bone_desc+i*8)) for i in range(a.u32(meta+16))]
            records=a.ptr(meta+28);vertex_env=a.ptr(meta+32)
            for i in range(n):
                record=a.ptr(records+a.unpack('H',vertex_env+i*2)[0]*4);actual={}
                for k in range(a.u32(record)):
                    j,w=a.unpack('If',record+4+k*8);j=bones[j];actual[j]=actual.get(j,0)+w
                assert actual==dict(envs[i]),(slug,color,'envelope',i)
            assert set(a.roots())==set(layout['exports']) and spec['costumes'][color]['symbol'] in a.roots()
            for dobj in set([layout['dobj'],layout['rootDobj']]):
                material=a.ptr(dobj+8);assert a.u32(material+24)==0x4f535549
                assert np.allclose(a.unpack('2f',material+68),[fit['scale'],fit['offset']],atol=1e-5,rtol=0),(slug,'stature')
            for attachment in layout['attachments']:
                transform=attachment_transform(rig['skeleton'],slug,attachment['joint'],profile)
                normal=np.linalg.inv(transform[:3,:3]).T
                for row in attachment['arrays']:
                    expected=normal@row['value'] if row['normal'] else (transform@np.r_[row['value'],1])[:3]
                    if row['normal']:expected/=np.linalg.norm(expected)
                    assert np.allclose(a.unpack('3f',row['offset']),expected,rtol=0,atol=1e-4),(slug,color,attachment['joint'],'attachment')
            for index in form_joints({'base_fighter':slug}):
                offset=layout['jointOffsets'][index];dobj=a.ptr(offset+16)
                assert dobj is not None and a.ptr(dobj+12) is not None,(slug,color,'alternate form')
            assert path.stat().st_size<=2*1024*1024
            count+=1
        print(slug,'all slots passed',flush=True)
    print(count,'costumes passed geometry, envelopes, stature, attachments, forms, exports and size checks')

if __name__=='__main__':main()
