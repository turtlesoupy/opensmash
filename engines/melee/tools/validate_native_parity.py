"""Compare native fitting to the existing Python converter across all movesets."""
import argparse, ctypes, json
from pathlib import Path
from validate_native_round import ROOT, humanoid, fixture, validate
from opensmash_melee.retarget_probe import TARGETS


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,action='append',required=True)
    p.add_argument('--library',type=Path,default=ROOT/'build/native-fit/fit.dylib')
    a=p.parse_args();lib=ctypes.CDLL(str(a.library.resolve()));results=[]
    for source in a.source:
        for slug,_,_ in TARGETS:
            if slug in ('kirby','jigglypuff'):
                data,mesh,rig,profile,reference=fixture(source,slug,ROOT/'assets/game/files')
                result=validate(lib,data,mesh,rig,profile,reference)
            else:data,result=humanoid(source,ROOT/'assets/game/files',lib,slug)
            (ROOT/'build/native-fit/fixtures'/f'{data["name"]}.json').write_text(json.dumps(data))
            results.append(result)
            print(data['name'],'PASS',flush=True)
    out=ROOT/'validation/native-fit/parity.json'
    out.write_text(json.dumps(results,indent=2)+'\n')
    print(len(results),'fits passed; report:',out)

if __name__=='__main__':main()
