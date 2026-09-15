"""Bundle locally generated experimental retargets into the native picker.

Only characters present in the probe and in the app are affected. Existing
six-target builds are retained. No ROM or generated asset enters source control.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from opensmash_melee.archive import Archive
from opensmash_melee.browser_skin import build_costume
from opensmash_melee.glb import GLB
from opensmash_melee.retarget import conform
from opensmash_melee.skeleton import joints
from opensmash_melee.presentation import panel

OPTIONS=json.loads((ROOT/'runtime/retarget-options.json').read_text())
STABLE={'mario','luigi','captain-falcon','fox','marth','link'}

def variant(raw,slots,color):
    archive=Archive(raw)
    mapping={slots[0][key]:slots[color][key] for key in ('symbol','materialSymbol') if slots[0][key]!='NULL'}
    for i,(offset,name) in enumerate(archive.public):
        symbol=archive.symbol(name)
        if symbol in mapping:
            archive.public[i]=(offset,len(archive.strings))
            archive.strings+=mapping[symbol].encode()+b'\0'
    return archive.serialize()

def bundle(resources,characters,probe=None):
    probe=probe or ROOT/'build/retarget-roster-probe'
    if not (probe/'report.json').exists():return
    for character in characters:
        source=ROOT.parents[1]/'play/ui'/character['slug']
        if not (source/'rigged.glb').exists():continue
        mesh=None;variants={}
        for option in OPTIONS:
            slug=option['slug'];profile_path=probe/slug/(character['slug']+'-profile.json')
            if slug in STABLE or not profile_path.exists():continue
            profile=json.loads(profile_path.read_text())
            digest=hashlib.sha256((source/'rigged.glb').read_bytes()).hexdigest()
            if profile['source_sha256']!=digest:raise ValueError('Probe source changed: '+character['slug'])
            if mesh is None:mesh=GLB(source/'rigged.glb').mesh()
            original=(ROOT/'assets/game/files'/option['costumes'][0]['filename']).read_bytes()
            skeleton=joints(Archive(original),profile['symbol'])
            fitted=conform(mesh,skeleton,profile);fitted['presentation']=panel(source)
            records=[];compact=[]
            for size,destination in [(256,records),(128,compact)]:
                raw,_=build_costume(original,fitted,skeleton,dict(profile,texture_size=size))
                for color,slot in enumerate(option['costumes']):
                    data=variant(raw,option['costumes'],color)
                    name=f"Characters/probe-{character['slug']}/{slug}/{size}/{slot['filename']}"
                    path=resources/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
                    destination.append(dict(filename=slot['filename'],path=name,sha256=hashlib.sha256(data).hexdigest()))
            variants[slug]=dict(fighter=option['fighter'],costumes=records,compactCostumes=compact)
        if 'popo' in variants:
            if 'nana' not in variants:raise ValueError('Ice Climbers needs both costumes')
            for key in ['costumes','compactCostumes']:
                for popo,nana in zip(variants['popo'][key],variants['nana'][key],strict=True):popo['companions']=[nana]
        added=[v for k,v in variants.items() if k!='nana']
        ids={v['fighter'] for v in added}
        character['targets']=[v for v in character.get('targets',[]) if v['fighter'] not in ids]+added
        print(character['slug'],len(added),'experimental targets bundled',flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('resources',type=Path);args=p.parse_args()
    path=args.resources/'build.json';info=json.loads(path.read_text());bundle(args.resources,info['characters']);path.write_text(json.dumps(info,indent=2)+'\n')
