"""Experimental roster mapping. Does not expand the shipping target allowlist."""
from pathlib import Path
import numpy as np
from .archive import Archive
from .skeleton import joints

TARGETS = [
 ('mario','Mr',0),('fox','Fx',1),('captain-falcon','Ca',2),
 ('donkey-kong','Dk',3),('kirby','Kb',4),('bowser','Kp',5),('link','Lk',6),
 ('sheik','Sk',7),('ness','Ns',8),('peach','Pe',9),('popo','Pp',10),
 ('nana','Nn',11),('pikachu','Pk',12),('samus','Ss',13),('yoshi','Ys',14),
 ('jigglypuff','Pr',15),('mewtwo','Mt',16),('luigi','Lg',17),('marth','Ms',18),
 ('zelda','Zd',19),('young-link','Cl',20),('dr-mario','Dr',21),('falco','Fc',22),
 ('pichu','Pc',23),('game-watch','Gw',24),('ganondorf','Gn',25),('roy','Fe',26)]

# These repairs refer to the actual neutral archive hierarchy, not another
# fighter's traversal indexes. All are experimental until runtime validation.
REPAIRS = {
 'kirby': {4:4,5:5,22:6,23:6,6:22,8:24,9:25,10:26,13:26,
           29:27,31:29,32:30,33:31,36:31,48:34,49:36,51:37,52:37,
           54:40,55:42,57:43,58:43},
 'ganondorf': {5:18,22:52,23:54},
 'samus': {33:50,36:50},
}

def load(game, spec):
    slug,code,kind=spec;game=Path(game)
    a=Archive.read(game/f'Pl{code}Nr.dat')
    symbol=next(k for k in a.roots() if k.endswith('_joint'))
    sk=joints(a,symbol)
    co=Archive.read(game/'PlCo.dat');table=co.ptr(co.roots()['ftLoadCommonData']+16)
    j2p=co.ptr(co.ptr(table));p2j=co.ptr(co.ptr(table+4*kind)+4)
    old=[4,5,22,23,6,8,9,10,13,29,31,32,33,36,48,49,51,54,55,57]
    mapping={};repairs=[]
    for i in old:
        part=co.unpack('B',j2p+i)[0]
        j=co.unpack('B',p2j+part)[0] if part!=255 else 255
        mapping[i]=j if j<len(sk) and sk[j]['inverse_bind'] is not None else None
    def put(i,j,why):
        mapping[i]=j;repairs.append(dict(source_joint=i,target_joint=j,reason=why))
    for i,j in REPAIRS.get(slug,{}).items():put(i,j,'Inspected neutral costume hierarchy')
    if mapping[23] is None:put(23,mapping[22] if mapping[22] is not None else mapping[5],'Head shares the neck/body anchor on this rig')
    if mapping[22] is None:put(22,sk[mapping[23]]['parent'],'Neck is the head parent')
    if mapping[5] is None:put(5,sk[mapping[6]]['parent'],'Torso is the clavicle parent')
    for hand,finger in [(10,13),(33,36)]:
        if mapping[hand] is None:
            elbow=9 if hand==10 else 32
            put(hand,mapping[elbow],'No distinct hand: retain terminal arm anchor')
        if mapping[finger] is None:put(finger,mapping[hand],'No finger endpoint: retain mitten volume')
    for foot,toe in [(51,52),(57,58)]:
        if toe in mapping:continue
        children=[j['index'] for j in sk if j['parent']==mapping[foot] and j['inverse_bind'] is not None]
        put(toe,children[0] if children else mapping[foot],'Authored foot child, or shared endpoint when absent')
    for i,j in mapping.items():
        if j is None or j>=len(sk) or sk[j]['inverse_bind'] is None:
            raise ValueError(f'{slug}: unresolved source joint {i} -> {j}')
    return dict(slug=slug,code=code,kind=kind,name=slug.replace('-',' ').title(),symbol=symbol,
                skeleton=sk,mapping=mapping,repairs=repairs,allow_collapsed_segments=True)
