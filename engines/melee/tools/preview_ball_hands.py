"""Render idle, run, jab and aerial views for the local big-head fits."""
import sys,json,numpy as np
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from opensmash_melee.glb import GLB
from opensmash_melee.retarget import conform,skin
from tools.validate_shape import render
out=ROOT/'build/retarget-roster-probe';sheet=Image.new('RGB',(1200,1220),'#161b24');d=ImageDraw.Draw(sheet)
for row,(source,slug) in enumerate([(s,t) for s in ['alanturing','abrahamlincoln'] for t in ['kirby','jigglypuff']]):
 t=json.loads((out/slug/'target.json').read_text());p=json.loads((out/slug/(source+'-profile.json')).read_text());m=conform(GLB(ROOT.parents[1]/'play/ui'/source/'rigged.glb').mesh(),t['skeleton'],p)
 poses=json.loads((out/slug/'poses.json').read_text())['poses'];ib=[np.array(j['inverse_bind']) if j['inverse_bind'] is not None else np.eye(4) for j in t['skeleton']]
 for col,pose in enumerate(['idle','run','jab','aerial']):
  if pose not in poses:continue
  v=skin(m['positions'],m['envelopes'],[np.array(w) for w in poses[pose]],ib);im=render(dict(m,positions=v),np.array([2**-.5,0,-2**-.5]),np.array([0,1,0]),23,np.array([0,6]),270);sheet.paste(im,(col*300,row*305+30));d.text((col*300+10,row*305+5),source+' '+slug+' '+pose,fill='white')
sheet.save(out/'hand-clearance.jpg')
