"""Compile Battleship's canonical pose corrections, rather than a second rewrite.

Extraction boundaries fail closed when the native implementation changes shape.
The source fingerprint is recorded alongside every compiled ROM module.
"""
import hashlib
import json
from pathlib import Path


def function(source, name):
    import re
    matches=list(re.finditer(r'^(?:static )?(?:void|s32|f32)\s+'+name+r'\([^;]*?\)\s*\{',source,re.M))
    if len(matches)!=1:raise ValueError('Cannot locate native function '+name)
    start=matches[0].start();at=source.index('{',matches[0].start());depth=1;end=at+1
    while depth:
        depth+=(source[end]=='{')-(source[end]=='}');end+=1
    return source[start:end]


def generate(decomp, output):
    path=Path(decomp)/'src/ft/ftport.c';source=path.read_text()
    contract_path=Path(__file__).with_name('native_contract.json')
    contract=json.loads(contract_path.read_text())
    current={name:hashlib.sha256(function(source,name).encode()).hexdigest() for name in contract['functions']}
    a=source.index('    o->wdamp = malloc');b=source.index('    if (o->canonical && o->have_tbnd)',a)
    current['weight_and_shoulder_setup']=hashlib.sha256(source[a:b].encode()).hexdigest()
    if current!=contract['sha256']:
        changed=[key for key in current if current[key]!=contract['sha256'].get(key)]
        raise ValueError('Battleship skinning changed; review the ROM parity adapter and tests before updating native_contract.json: '+', '.join(changed))
    body=function(source,'osb5_skin_update_body')
    start=body.index('        static f32 rd[32][3][3];')
    end=body.index('        if (getenv("SSB64_BOB_DBG")',start)
    core=body[start:end]
    helpers=['osb5_mul3','osb5_inv3','osb5_align3','osb5_rpy_to_m3',
             'osb5_target_is_upright_biped','osb5_canonical_slot_is_arm','osb5_on_menu_scene']
    text='/* Generated from Battleship ftport.c. Do not hand edit. */\n'
    text+='\n'.join(function(source,name) for name in helpers)
    text+='\nstatic __attribute__((noinline,minsize)) void native_pose(OSB5State *o, FTStruct *fp, int mesh_slot, float jo[32][3], float jm[32][3][3], float t0o[3], float t0m[3][3], float out_delta[SKIN_JOINT_CAP][3][3]) {\n'+core+'\nif(out_delta) memcpy(out_delta,rd,sizeof(rd));\n}\n'
    # Math and memory calls have local freestanding implementations. Runtime
    # environment overrides/debug logging are disabled, native defaults retained.
    text=text.replace('[32]', '[SKIN_JOINT_CAP]')
    text=text.replace('extern float atan2f(float, float);','').replace('extern float sinf(float);','').replace('extern float cosf(float);','').replace('extern int port_get_frame_count(void);','').replace('extern s32 port_current_scene(void);','')
    out=Path(output);out.mkdir(parents=True,exist_ok=True)
    (out/'native_pose.inc').write_text(text)
    manifest={'source':str(path),'sha256':hashlib.sha256(source.encode()).hexdigest(),'helpers':helpers,'pose_sha256':hashlib.sha256(core.encode()).hexdigest()}
    (out/'native_pose.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest
