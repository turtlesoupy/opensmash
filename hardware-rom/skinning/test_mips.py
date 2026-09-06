"""Execute the actual ROM MIPS wrapper and skinner with deterministic game stubs.

Run with PYTHONPATH=build/test-deps SKIN_ROM=... python3 -m unittest discover
-s hardware-rom/skinning -p 'test_mips.py'. Unicorn is a test-only dependency.
"""
import os
import ctypes
import subprocess
from pathlib import Path
import struct
import sys
import unittest
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from build_rom import TABLE, DATA, ENTRY, chain
from skinning.patches import HOOK_ROM
try:
    from unicorn import Uc, UC_ARCH_MIPS, UC_MODE_MIPS32, UC_MODE_BIG_ENDIAN, UC_HOOK_CODE
    from unicorn.mips_const import UC_MIPS_REG_A0,UC_MIPS_REG_A1,UC_MIPS_REG_RA,UC_MIPS_REG_SP,UC_MIPS_REG_F0,UC_MIPS_REG_F12,UC_MIPS_REG_F14,UC_MIPS_REG_CP0_STATUS
except ImportError:
    Uc=None


@unittest.skipUnless(Uc and os.environ.get('SKIN_ROM'),'MIPS emulator and skinned ROM fixture required')
class RuntimeTests(unittest.TestCase):
    asset_id=296
    def setUp(self):
        rom=Path(os.environ['SKIN_ROM']).read_bytes()
        e=ENTRY.unpack_from(rom,TABLE+self.asset_id*12)
        self.base=0x80200000
        raw=bytearray(rom[DATA+e[0]:DATA+e[0]+e[4]*4])
        for at,target in chain(raw,e[1]).items():struct.pack_into('>I',raw,at,self.base+target)
        marker=raw.find(bytes.fromhex('df00000000000000534b4e31'))
        self.marker=self.base+marker
        self.u=Uc(UC_ARCH_MIPS,UC_MODE_MIPS32|UC_MODE_BIG_ENDIAN)
        self.u.mem_map(0,4*1024*1024)
        self.write(self.base,raw)
        ce=ENTRY.unpack_from(rom,TABLE+163*12)
        common=bytearray(rom[DATA+ce[0]:DATA+ce[0]+ce[4]*4])
        for at,target in chain(common,ce[1]).items():struct.pack_into('>I',common,at,0x80180000+target)
        self.write(0x80180000,common)
        self.word(0x80130d98,0x80180000)
        self.write(0x800f24a0,rom[HOOK_ROM:HOOK_ROM+228])
        self.gobj=0x80100000;self.fp=0x80101000
        self.word(self.gobj+0x84,self.fp)
        self.word(self.gobj+0x74,0x80110000)
        self.word(self.fp+0x9c8,0x80120000)
        self.frames={}
        self.joints={}
        self.frames[0x80110000]=(np.array([0,1000,0.]),np.eye(3))
        self.word(self.fp+0x8e8,0x80110000)
        nj=self.word(self.marker+32)
        at=self.word(self.marker+40)
        for i in range(nj):
            jid= self.word(at+i*92)
            frame=np.array(struct.unpack('>12f',self.read(at+i*92+8,48)))
            dobj=0x80110000+jid*0x100
            self.frames[dobj]=(frame[:3],frame[3:].reshape(3,3))
            self.joints[i]=dobj
            self.word(self.fp+0x8e8+jid*4,dobj)
        self.word(self.fp+0x8f8,0x80110400)
        self.word(0x80110400+0x50,self.marker)
        self.frames[0x80110400]=self.frames[0x80110000]
        self.word(0x800465d8+8,0x80308000)
        self.word(0x800465d8+12,0x80300000)
        self.word(0x800465b0,0x80130000)
        self.scene=0;self.kind=3 if self.asset_id==320 else 0;self.have_parent=False
        self.word(self.fp+8,self.kind)
        self.calls=[]
        for address in (0x800edf24,0x800f1e60,0x800f21b4,0x800f1020,0x800344b0,0x80039160,0x800303f0,0x80035cd0,0x8001863c,0x800eb528):
            self.write(address,bytes.fromhex('03e0000800000000'))
        def game_call(uc,address,size,user):
            physical=address&0x1fffffff
            if physical==0xedf24:
                joint=uc.reg_read(UC_MIPS_REG_A0);vec=uc.reg_read(UC_MIPS_REG_A1)
                p=np.array(struct.unpack('>3f',self.read(vec,12)))
                origin,matrix=self.frames[joint]
                self.write(vec,struct.pack('>3f',*(matrix@p+origin)))
            elif physical in (0x303f0,0x35cd0,0x1863c):
                x=struct.unpack('f',struct.pack('I',uc.reg_read(UC_MIPS_REG_F12)))[0]
                y=struct.unpack('f',struct.pack('I',uc.reg_read(UC_MIPS_REG_F14)))[0]
                value=np.sin(x) if physical==0x303f0 else np.cos(x) if physical==0x35cd0 else np.arctan2(x,y)
                uc.reg_write(UC_MIPS_REG_F0,struct.unpack('I',struct.pack('f',value))[0])
            elif physical in (0xf1e60,0xf21b4,0xf1020,0x344b0,0x39160):self.calls.append(physical)
        self.u.hook_add(UC_HOOK_CODE,game_call)
        self.u.reg_write(UC_MIPS_REG_CP0_STATUS,0x20000000)

    def read(self,at,size):return self.u.mem_read(at&0x1fffffff,size)
    def write(self,at,data):self.u.mem_write(at&0x1fffffff,bytes(data))
    def word(self,at,value=None):
        if value is None:return struct.unpack('>I',self.read(at,4))[0]
        self.write(at,struct.pack('>I',value))
    def run_draw(self, failures=0):
        self.u.reg_write(UC_MIPS_REG_A0,self.gobj)
        self.u.reg_write(UC_MIPS_REG_SP,0x803ff000)
        self.u.reg_write(UC_MIPS_REG_RA,0x80001000)
        self.u.emu_start(0x800f24a0,0x80001000,count=2000000)
        self.assertEqual(self.word(self.marker+72),failures,'Unexpected skinning failure count')

    def test_insufficient_arena_does_not_overwrite_memory(self):
        start=self.word(0x800465d8+12)
        self.word(0x800465d8+8,start+16)
        self.write(start,b'\xa5'*64)
        self.run_draw(failures=1)
        self.assertEqual(self.word(0x800465d8+12),start)
        self.assertEqual(self.read(start,64),b'\xa5'*64)
        self.assertNotIn(0xf1e60,self.calls)

    def test_root_display_list_restored_after_draw(self):
        self.word(0x80110000+0x50,0x80123450)
        self.run_draw()
        self.assertEqual(self.word(0x80110000+0x50),0x80123450)

    def test_degenerate_root_transform_rejected(self):
        self.frames[0x80110000]=(np.zeros(3),np.zeros((3,3)))
        start=self.word(0x800465d8+12)
        self.run_draw(failures=1)
        self.assertEqual(self.word(0x800465d8+12),start)
        self.assertNotIn(0xf1e60,self.calls)

    def reference(self):
        n=self.word(self.marker+24);at=self.word(self.marker+44)
        frames={i:self.frames[dobj] for i,dobj in self.joints.items()}
        if self.word(self.marker+36)&1:
            source=Path(__file__).with_name('pose_reference.c')
            generated=Path(os.environ['SKIN_ROM']).parent/'mips-runtime'
            libpath=generated/'reference.dylib'
            subprocess.run(['clang','-shared','-O2','-DSKIN_JOINT_CAP=16','-I',str(source.parent),'-I',str(generated),str(source),'-o',str(libpath)],check=True)
            lib=ctypes.CDLL(str(libpath.resolve()))
            config=np.frombuffer(self.read(self.word(self.marker+76),1596),dtype='>u4').astype('=u4').copy()
            live=np.array([np.r_[frames[i][0],frames[i][1].ravel()] for i in range(len(frames))],dtype=np.float32)
            top=np.r_[self.frames[0x80110000][0],self.frames[0x80110000][1].ravel()].astype(np.float32)
            parent=np.r_[self.frames[0x80110400][0],self.frames[0x80110400][1].ravel()].astype(np.float32);out=np.zeros_like(live);lifts=np.zeros((2,3),dtype=np.float32)
            ptr=lambda x:ctypes.c_void_p(x.ctypes.data)
            lib.reference_pose(ptr(config),ptr(live),ptr(top),ptr(parent),int(self.have_parent),self.scene,self.kind,0,ptr(out),ptr(lifts))
            self.reference_lifts=lifts.copy()
            frames={i:(row[:3],row[3:].reshape(3,3)) for i,row in enumerate(out)}
        self.reference_frames=frames
        result=[]
        for i in range(n):
            values=struct.unpack('>3h8B2x',self.read(at+i*16,16))
            point=np.array(values[:3]);slots=values[3:7];weights=np.array(values[7:11])
            local=[]
            joint_at=self.word(self.marker+40)
            for slot in slots:
                bind=np.array(struct.unpack('>12f',self.read(joint_at+slot*92+8,48)))
                local.append(np.linalg.solve(bind[3:].reshape(3,3),point-bind[:3]))
            world=np.array([frames[j][1]@p+frames[j][0] for j,p in zip(slots,local)])
            p=np.average(world,axis=0,weights=weights)
            if self.word(self.marker+36)&1:
                prox=self.read(self.word(self.marker+76)+1596+i*4,4)
                for q in range(2):p+=prox[q]/255*(1-prox[2]/255)*lifts[q]
            origin,matrix=self.frames[0x80110000]
            result.append(np.linalg.solve(matrix,p-origin))
        normals=[]
        cfg=self.word(self.marker+80);nnormal=cfg+20+self.word(cfg+16)*88
        for i in range(n):
            values=struct.unpack('>3h8B2x',self.read(at+i*16,16));slots=values[3:7];weights=values[7:11]
            normal=np.array(struct.unpack('>3b',self.read(nnormal+i*4,3)))
            world=np.zeros(3)
            for slot,w in zip(slots,weights):
                bind=np.array(struct.unpack('>12f',self.read(self.word(self.marker+40)+slot*92+8,48)))
                world+=w*(frames[slot][1]@np.linalg.solve(bind[3:].reshape(3,3),normal))
            local=np.linalg.solve(self.frames[0x80110000][1],world);length=np.linalg.norm(local)
            normals.append(local*127/length if length else np.zeros(3))
        self.reference_normals=np.array(normals)
        return np.array(result)

    def test_actual_mips_skinning_and_four_duplicate_buffers(self):
        # Bend a live joint; compare compiled CPU results to NumPy LBS.
        j=self.joints[1];origin,matrix=self.frames[j]
        angle=.65;c=np.cos(angle);s=np.sin(angle)
        self.frames[j]=(origin,np.array([[c,-s,0],[s,c,0],[0,0,1.]])@matrix)
        expected=self.reference()
        count=self.word(self.marker+28);mapping=self.word(self.marker+48)
        ids=struct.unpack('>'+str(count)+'H',self.read(mapping,count*2))
        snapshots=[]
        for _ in range(4):
            start=self.word(0x800465d8+12)
            head=self.word(0x800465b0)
            self.run_draw()
            self.assertEqual(self.word(head),0xdb060034,'Do not overwrite engine segments E/F')
            self.assertEqual(self.word(head+4),start&0x1fffffff)
            data=bytes(self.read(start,count*16));snapshots.append((start,data))
            positions=np.array([struct.unpack_from('>3h',data,i*16) for i in range(count)])
            np.testing.assert_allclose(positions,expected[list(ids)],atol=1.01,rtol=0)
            normals=np.array([struct.unpack_from('>3b',data,i*16+12) for i in range(count)])
            np.testing.assert_allclose(normals,self.reference_normals[list(ids)],atol=1.01,rtol=0)
        for start,data in snapshots:self.assertEqual(bytes(self.read(start,len(data))),data)
        self.assertEqual(self.calls.count(0xf1e60),4)
        self.assertEqual(self.calls.count(0x344b0),1)
        self.assertEqual(self.calls.count(0x39160),1)

    def test_vanilla_and_afterimage_paths(self):
        self.word(0x80110400+0x50,0)
        self.write(self.fp+0xa9d,b'\x02')
        self.run_draw()
        self.assertEqual(self.calls,[0xf1e60,0xf1020])

    def test_vanilla_skeleton_path(self):
        self.word(0x80110400+0x50,0)
        self.write(self.fp+0xa88,b'\x08')
        self.word(0x80120000+0x344,0x80121000)
        self.word(0x80121000,6);self.word(0x80121004,0x80122000)
        self.word(0x80110600+0x50,0x80122000)
        self.run_draw()
        self.assertEqual(self.calls,[0xf21b4])


class CanonicalRuntimeTests(RuntimeTests):
    """Repeat the actual MIPS checks with Casey's CAN1/TBND asset."""
    asset_id=320

    def test_menu_alignment_matches_native_source(self):
        self.scene=16;self.write(0x800a4ad0,b'\x10')
        self.have_parent=True;self.word(self.joints[0]+20,0x80110400)
        self.test_actual_mips_skinning_and_four_duplicate_buffers()

    def test_interior_translation_matches_native_source(self):
        self.have_parent=True;self.word(self.joints[0]+20,0x80110400)
        o,m=self.frames[0x80110400];self.frames[0x80110400]=(o+np.array([120,-160,80]),m)
        self.test_actual_mips_skinning_and_four_duplicate_buffers()

    def test_accessory_pin_and_body_swap_are_restored_after_render(self):
        cfg=self.word(self.marker+80);n=self.word(self.marker+24)
        new=0x80170000
        header=bytearray(self.read(cfg,20));struct.pack_into('>I',header,16,1)
        point=np.array([10.,50.,20.]);normal=np.array([0.,127.,0.])
        pin=struct.pack('>I6f8B13f',36,*point,*normal,0,0,0,0,255,0,0,0,5,0,0,0,*np.eye(3).ravel())
        self.write(new,header+pin+bytes(self.read(cfg+20,n*4)));self.word(self.marker+80,new)
        d=0x80112400;parts=0x80160000
        self.word(self.fp+0x8e8+36*4,d);self.frames[d]=(np.zeros(3),np.eye(3))
        self.word(d+20,0x80110000);self.word(d+132,parts)
        self.word(parts,2);saved_matrix=np.arange(16,dtype='>f4').tobytes();self.write(parts+16,saved_matrix)
        body=self.joints[0];self.word(body+0x50,0x80123450)
        self.reference();origin,matrix=self.reference_frames[0]
        bind=np.array(struct.unpack('>12f',self.read(self.word(self.marker+40)+8,48)))
        inv=np.linalg.inv(bind[3:].reshape(3,3));wn=matrix@inv@normal
        expected=matrix@inv@(point-bind[:3])+origin-wn/np.linalg.norm(wn)*5-self.frames[0x80110000][0]
        observed=[]
        def inspect(u,address,size,unused):
            if address&0x1fffffff==0xf1e60:
                observed.append(np.array(struct.unpack('>3f',self.read(parts+16+48,12))))
                self.assertEqual(self.word(parts),1)
                self.assertEqual(self.word(body+0x50),0)
        self.u.hook_add(UC_HOOK_CODE,inspect);self.run_draw()
        self.assertEqual(len(observed),1);np.testing.assert_allclose(observed[0],expected,atol=.05)
        self.assertEqual(self.word(parts),2);self.assertEqual(bytes(self.read(parts+16,64)),saved_matrix)
        self.assertEqual(self.word(body+0x50),0x80123450)

    def test_non_upright_menu_matches_native_source(self):
        self.scene=16;self.kind=8
        self.write(0x800a4ad0,b'\x10');self.word(self.fp+8,self.kind)
        self.test_actual_mips_skinning_and_four_duplicate_buffers()

    def test_raised_shoulder_lift_matches_native_source(self):
        j=self.joints[1];origin,matrix=self.frames[j]
        for angle in np.linspace(0,6,9):
            c=np.cos(angle);s=np.sin(angle)
            self.frames[j]=(origin,np.array([[c,-s,0],[s,c,0],[0,0,1.]])@matrix)
            expected=self.reference()
            if np.linalg.norm(self.reference_lifts)>1:break
        self.assertGreater(np.linalg.norm(self.reference_lifts),1,'Fixture must exercise shoulder lift')
        start=self.word(0x800465d8+12);self.run_draw()
        count=self.word(self.marker+28);data=self.read(start,count*16)
        actual=np.array([struct.unpack_from('>3h',data,i*16) for i in range(count)])
        np.testing.assert_allclose(actual,expected,atol=1.01,rtol=0)
