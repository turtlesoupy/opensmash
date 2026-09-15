"""Local naive roster sweep: fitted DATs, original HSD poses, comparison sheets.

Experimental outputs never enter the playable target catalog automatically.
"""
import argparse, hashlib, json, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.retarget_probe import TARGETS,load
from opensmash_melee.multi_fighter import fit
from opensmash_melee.glb import GLB
from opensmash_melee.retarget import conform,skin
from opensmash_melee.archive import Archive
from opensmash_melee.gx import replace_costume
from opensmash_melee.target_presentation import stature
from opensmash_melee.proportions import source_head_fit
from opensmash_melee.presentation import panel
from tools.inspect_costume_bounds import inspect
from tools.validate_shape import render,shape_metrics
from tools.extract_browser_animations import extract

SOURCES=['alanturing','abrahamlincoln']
def dump(path,data):
    path.write_text(json.dumps(data,indent=2,default=lambda x:x.tolist() if hasattr(x,'tolist') else str(x))+'\n')

def main():
    ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--output',type=Path,default=ROOT/'build/retarget-roster-probe');ap.add_argument('--render-only',action='store_true');args=ap.parse_args()
    out=args.output.resolve();out.mkdir(parents=True,exist_ok=True);game=ROOT/'assets/game/files'
    meshes={s:GLB(ROOT.parents[1]/f'play/ui/{s}/rigged.glb').mesh() for s in SOURCES}
    rows=[];prepared={}
    for spec in TARGETS:
        slug,code,kind=spec;folder=out/slug;folder.mkdir(exist_ok=True)
        row=dict(target=slug,code=code,kind=kind,characters={},warnings=[]);rows.append(row)
        try:
            t=load(game,spec);original,_=inspect(str(game/f'Pl{code}Nr.dat'));t['original_bounds']=[original.min(0).tolist(),original.max(0).tolist()]
            animations=extract((game/f'Pl{code}AJ.dat').read_bytes())
            if slug=='nana':
                animations+=extract((game/'PlPpAJ.dat').read_bytes());row['warnings'].append('Nana uses shared Popo common motion; pair runtime still needs validation')
            wanted=[('idle',['Wait1','Wait']),('run',['Run','WalkFast']),('jab',['Attack11','AttackS3S']),('aerial',['AttackAirF','AttackAirN'])]
            t['animations']=[]
            for label,names in wanted:
                a=next((a for n in names for a in animations if a['name'].endswith('ACTION_'+n+'_figatree') and a['joints']==len(t['skeleton'])),None)
                if a:t['animations'].append(dict(a,label=label))
                else:row['warnings'].append('No compatible '+label+' clip')

            if slug in ('kirby','jigglypuff'):row['warnings'].append('Big-head fit: internal torso, independent hands and shoes')
            if slug=='samus':row['warnings'].append('Arm cannon states need runtime attachment review')
            if slug in ('popo','nana','roy','young-link'):row['warnings'].append('Native equipment retained in DAT; sheet shows custom body only')
            row['repairs']=t['repairs'];row['original_bounds']=t['original_bounds'];row['joints']=len(t['skeleton'])
            dump(folder/'target.json',t);prepared[slug]=(t,{})
            for source,mesh in meshes.items():
                try:
                    profile=source_head_fit(mesh,t['skeleton'],fit(mesh,t))
                    if slug in ('kirby','jigglypuff'):
                        profile.update(ball_fit={'version':1,'radius':4.3 if slug=='kirby' else 4.5},head_style='ball')
                        from tools.fit_ball_hands import fit_hands
                        subprocess.run(['node',str(ROOT/'tools/probe_retarget_poses.mjs'),str(out),slug],check=True)
                        samples=json.loads((folder/'poses.json').read_text())['clearancePoses']
                        profile=fit_hands(mesh,t['skeleton'],profile,samples)
                    fitted=conform(mesh,t['skeleton'],profile)
                    profile.update(symbol=t['symbol'],mesh_joint=0,mesh_dobj=(6 if slug=='kirby' else 0),stature=({'scale':1.0,'offset':0.0,'version':1} if profile.get('ball_fit') else stature(fitted,original)),status='experimental_roster_probe',isolate_body_texture_animation=True,source_sha256=hashlib.sha256((ROOT.parents[1]/f'play/ui/{source}/rigged.glb').read_bytes()).hexdigest())

                    gear={'popo':[15],'nana':[15],'roy':[21,77,78],'young-link':[27,28,71,73,74,75]}
                    if slug in gear:
                        profile.update(preserve_attachment_joints=gear[slug],attachment_scale=1/profile['stature']['scale'],attachment_anchors={'78':77} if slug=='roy' else {'28':27,'74':73,'75':73} if slug=='young-link' else {})
                    metrics=shape_metrics(mesh,fitted,profile,t['skeleton']);dump(folder/(source+'-profile.json'),profile)
                    record=dict(metrics=metrics,stature=profile['stature']);row['characters'][source]=record
                    if not args.render_only:
                        archive=Archive.read(game/f'Pl{code}Nr.dat');stats=replace_costume(archive,dict(fitted,image=fitted['image'].resize((256,256)),presentation=panel(ROOT.parents[1]/f'play/ui/{source}')),t['skeleton'],profile)
                        raw=archive.serialize();(folder/(source+'.dat')).write_bytes(raw);record['export']=dict(stats,sha256=hashlib.sha256(raw).hexdigest(),bytes=len(raw))
                    prepared[slug][1][source]=(fitted,profile)
                except Exception as e:row['characters'][source]={'error':str(e)}
            print(slug,{s:r.get('error','fitted') for s,r in row['characters'].items()},flush=True)
        except Exception as e:row['error']=str(e);print(slug,'FAILED',e,flush=True)
    dump(out/'report.json',rows)
    subprocess.run(['node',str(ROOT/'tools/probe_retarget_poses.mjs'),str(out)],check=True)
    fontpath='/System/Library/Fonts/Supplemental/Arial.ttf'
    font=ImageFont.truetype(fontpath,18);small=ImageFont.truetype(fontpath,13);title=ImageFont.truetype(fontpath,26)
    right=np.array([2**-.5,0,-2**-.5]);up=np.array([0,1,0]);size=240;cache={}
    for row in rows:
        slug=row['target'];folder=out/slug
        if slug not in prepared:continue
        t,characters=prepared[slug];posefile=folder/'poses.json'
        if not posefile.exists():row['warnings'].append('Pose bake failed');continue
        poses=json.loads(posefile.read_text());row['motion']=poses.get('report',[]);row['warnings']+=poses.get('warnings',[])
        if poses.get('error'):row['warnings'].append(poses['error']);continue
        sk=t['skeleton'];ib=[np.array(j['inverse_bind']) if j['inverse_bind'] is not None else np.eye(4) for j in sk]
        rendered={}
        for source,(m,p) in characters.items():
            displays={'bind':m['positions']}
            for name,worlds in poses['poses'].items():
                displays[name]=skin(m['positions'],m['envelopes'],[np.array(x) for x in worlds],ib)
            scale=p['stature']['scale'];off=p['stature']['offset']
            displays={n:v*scale+np.array([0,off,0]) for n,v in displays.items()}
            rendered[source]={n:dict(m,positions=v) for n,v in displays.items()}
            row['characters'][source]['pose_bounds']={n:[v.min(0).tolist(),v.max(0).tolist()] for n,v in displays.items()}
        # One camera per target, shared across both characters and all poses.

        if not rendered:row['warnings'].append('No fitted meshes available');continue
        allpos=np.concatenate([m['positions'] for d in rendered.values() for m in d.values()]);uv=np.c_[allpos@right,allpos@up]
        lo=uv.min(0);hi=uv.max(0);extent=float(max(hi-lo)*1.13);center=(lo+hi)/2
        for source,d in rendered.items():
            for pose,m in d.items():
                im=render(m,right,up,extent,center,size);im.save(folder/f'{source}-{pose}.png');cache[(slug,source,pose)]=im
        row['camera']=dict(right=right.tolist(),up=up.tolist(),extent=extent,center=center.tolist())
        print(slug,'rendered',flush=True)
    for page in range(3):
        subset=rows[page*9:(page+1)*9];sheet=Image.new('RGB',(1240,130+len(subset)*294),'#161b24');d=ImageDraw.Draw(sheet)
        d.text((20,16),f'Retarget sweep {page+1}/3 — original HSD animation poses',font=title,fill='white')
        d.text((20,51),'Experimental geometry review, not gameplay acceptance. Same camera per row; texture-only lighting.',font=font,fill='#bcc7d8')
        columns=[('alanturing','bind'),('alanturing','idle'),('alanturing','run'),('alanturing','jab'),('abrahamlincoln','idle')]
        for col,(source,pose) in enumerate(columns):d.text((20+col*244,88),('Turing' if source=='alanturing' else 'Lincoln')+' / '+pose,font=font,fill='white')
        for k,row in enumerate(subset):
            y=126+k*294;slug=row['target'];d.text((20,y),slug.replace('-',' ').title(),font=font,fill='#f5ce79')
            for col,(source,pose) in enumerate(columns):
                im=cache.get((slug,source,pose))
                if im:sheet.paste(im,(20+col*244,y+27))
                else:d.text((20+col*244,y+90),'UNRESOLVED',font=font,fill='#f29393')
            note=row.get('error') or '; '.join(row['warnings']) or 'Mapped and sampled; proportions / equipment require visual review'
            d.text((20,y+270),note[:170],font=small,fill='#bcc7d8')
        sheet.save(out/f'sheet-{page+1}.jpg',quality=93)
    overview=Image.new('RGB',(1440,80+5*285),'#161b24');d=ImageDraw.Draw(overview);d.text((20,20),'All 27 fighter rigs — Turing / idle',font=title,fill='white')
    for n,row in enumerate(rows):
        x=(n%6)*240;y=80+(n//6)*285;im=cache.get((row['target'],'alanturing','idle'))
        if im:overview.paste(im,(x,y))
        d.text((x+8,y+244),row['target'].replace('-',' ').title(),font=font,fill='white')
    overview.save(out/'overview.jpg',quality=93)
    pair=Image.new('RGB',(1000,610),'#161b24');d=ImageDraw.Draw(pair);d.text((20,18),'Ice Climbers: separate Popo and Nana fits',font=title,fill='white')
    for i,source in enumerate(SOURCES):
        for j,slug in enumerate(['popo','nana']):
            im=cache.get((slug,source,'idle'))
            if im:pair.paste(im,(20+(i*2+j)*244,90))
            d.text((20+(i*2+j)*244,65),source+' / '+slug,font=small,fill='white')
    d.text((20,365),'Two meshes, two skeletons. This sheet does not prove partner spawning or hammer attachment.',font=font,fill='#bcc7d8');pair.save(out/'ice-climbers.jpg',quality=93)
    ball=Image.new('RGB',(1200,680),'#161b24');draw=ImageDraw.Draw(ball)
    for row,source in enumerate(SOURCES):
        for col,slug in enumerate(['kirby','jigglypuff']):
            for sub,pose in enumerate(['idle','run']):
                x=col*600+sub*300;y=row*340
                draw.text((x+12,y+10),source+' / '+slug+' / '+pose,font=small,fill='white')
                im=cache.get((slug,source,pose))
                if im:ball.paste(im.resize((300,300)),(x,y+35))
    ball.save(out/'big-head.jpg',quality=94)
    dump(out/'report.json',rows)
    links='<h2>Kirby and Jigglypuff: big-head fit</h2><img src="big-head.jpg">'
    links+=''.join(f'<h2>Sheet {i}</h2><img src="sheet-{i}.jpg">' for i in range(1,4))
    (out/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width"><title>Retarget sweep</title><style>body{background:#161b24;color:#eee;font:18px system-ui;margin:24px}img{max-width:100%}a{color:#aef}</style><h1>Naive retarget sweep</h1><p>Local shape and original-animation review. Experimental DATs; not promoted to the playable roster.</p><img src="overview.jpg">'+links+'<h2>Ice Climbers</h2><img src="ice-climbers.jpg"><p><a href="report.json">Detailed mapping / pose / export report</a></p>')
    print(out/'index.html',flush=True)
if __name__=='__main__':main()
