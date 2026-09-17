"""Check browser-assembled DATs against the native benchmark's validated fixtures."""
from pathlib import Path
import json
import sys
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from opensmash_melee.archive import Archive

def main():
    folder=ROOT/'build/native-fit/local-validation'
    count=0
    for file in sorted(folder.glob('*.dat')):
        name=file.stem;target=name.rsplit('-',1)[1]
        t=json.loads((ROOT/'build/native-fit/local/targets'/f'{target}.json').read_text())
        t={**t,**t['layouts'][1]}
        f=json.loads((ROOT/'build/native-fit/fixtures'/f'{name}.json').read_text())
        a=Archive.read(file);pobj=a.ptr(t['dobj']+12);desc=a.ptr(pobj+8);meta=a.ptr(desc+4*24+20)
        n=a.u32(meta+8);assert n==f['n']
        for key,field in [('expectedPositions',20),('expectedNormals',24)]:
            actual=np.frombuffer(a.data,dtype='>f4',count=n*3,offset=a.ptr(meta+field))
            assert np.array_equal(actual,np.asarray(f[key],dtype=np.float32)),(name,key)
        # Resolve runtime bone palette back to original skeleton traversal ids.
        table=a.ptr(pobj+20);bone_desc=a.ptr(table);bones=[]
        for i in range(a.u32(meta+16)):bones.append(t['jointOffsets'].index(a.ptr(bone_desc+i*8)))
        records=a.ptr(meta+28);vertex_env=a.ptr(meta+32);slots=5 if t['mode']=='round' else 4
        for i in range(n):
            e=a.unpack('H',vertex_env+i*2)[0];record=a.ptr(records+e*4);actual={}
            for k in range(a.u32(record)):
                j,w=a.unpack('If',record+4+k*8);j=bones[j];actual[j]=actual.get(j,0)+w
            expected={j:w for j,w in zip(f['expectedJoints'][i*slots:(i+1)*slots],f['expectedWeights'][i*slots:(i+1)*slots]) if j!=4294967295}
            assert actual==expected,(name,'envelope',i)
        assert t['slots'][1]['symbol'] in a.roots()
        assert set(t['exports'])==set(a.roots()),'Required costume accessory exports were lost'
        for dobj in set([t['dobj'],t['rootDobj']]):
            material=a.ptr(dobj+8);assert a.u32(material+24)==0x4f535549
            assert a.ptr(material+48)==t['jointOffsets'][t['headJoint']]
        assert len(file.read_bytes())<=2*1024*1024
        count+=1
    if not count:raise ValueError('Run validate_native_fit_local.mjs first')
    print(f'{count} assembled costumes passed geometry, envelopes, identity, relocations, size and color-slot checks.')
if __name__=='__main__':main()
