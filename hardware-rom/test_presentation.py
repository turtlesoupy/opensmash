"""ROM presentation regressions. No downloaded character assets required."""
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import unittest

import numpy as np

from face_textures import SurfaceSampler
from build_rom import COUNT, DATA, ENTRY, TABLE, chain
from presentation import (CTL, EMBLEM_TABLES, MODELS, Reloc, encode_adpcm,
                          patch_ui, swizzle, symbols, unword, voice_info)
from pipeline.dump_fgm_bank import decode_vadpcm
from verify_rom import verify

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT.parent/'BattleShip/baserom.us.z64'
DECOMP = ROOT.parent/'BattleShip/decomp'


def sprite():
    raw = bytearray(256)
    struct.pack_into('>4h2f',raw,0,0,0,8,8,1,1)
    struct.pack_into('>h',raw,40,1)
    struct.pack_into('>hhBB',raw,44,8,8,4,0)
    struct.pack_into('>4hIhh',raw,72,8,16,0,0,0,8,0)
    return Reloc(raw,{52:72,80:96},{})


class SpriteTests(unittest.TestCase):
    def test_css_budget_counts_more_than_four_fighters(self):
        base=bytes(2*1024*1024)
        rom=bytearray(base)
        # Four 80 KB models fit the growth budget, five do not. CSS loads
        # all five even though only four fighters can be active in battle.
        for fid in range(5):
            ENTRY.pack_into(rom,TABLE+fid*12,0,65535,20000,65535,20000)
        with self.assertRaisesRegex(AssertionError,'Character-select asset growth'):
            verify(base,rom,[])

    def test_flat_head_tiles_use_shading_but_keep_sharp_detail(self):
        from face_textures import shade_equivalent
        pixels=np.full((12,12),(12<<11)|(9<<6)|(6<<1)|1,dtype='>u2')
        colors=shade_equivalent(pixels.tobytes(),12)
        np.testing.assert_array_equal(colors,np.tile(np.rint(np.array([12,9,6])*255/31).astype(int),(3,1)))
        # An interior eye/mouth detail must not disappear into flat shading.
        pixels[4:6,4:6]=1
        self.assertIsNone(shade_equivalent(pixels.tobytes(),12))

    def test_n64_order_is_not_native_word_order(self):
        linear=bytes(range(64))
        encoded=swizzle(linear,16,8,4)
        self.assertEqual(encoded[8:16],bytes([12,13,14,15,8,9,10,11]))
        self.assertEqual(swizzle(encoded,16,8,4),linear)
        self.assertEqual(unword(bytes([3,2,1,0,7,6,5,4])),bytes(range(8)))

    def test_clone_does_not_mutate_shared_vanilla_emblem(self):
        r=sprite();r.data[96:160]=b'\x99'*64
        original=bytes(r.data)
        clone=r.clone_sprite(0)
        canvas=np.zeros((48,48),dtype=np.uint8);canvas[10:30,20:24]=255
        r.emblem(clone,canvas)
        self.assertEqual(r.data[:len(original)],original)
        blob,first,_=r.finish();pointers=chain(blob,first)
        self.assertNotEqual(pointers[pointers[clone+52]+8],96)
        self.assertEqual(blob[96:160],b'\x99'*64)

    def test_name_widens_storage_without_truncating_last_letter(self):
        r=sprite();r.data[48:50]=bytes([3,1])
        canvas=np.zeros((16,64),dtype=np.uint8);canvas[3:10,50:59]=255
        r.name(0,canvas.tobytes(),16,True)
        self.assertEqual(struct.unpack_from('>h',r.data,4)[0],59)
        self.assertEqual(struct.unpack_from('>h',r.data,74)[0],64)
        at=r.internal[80]
        decoded=swizzle(r.data[at:at+1024],64,16,8)
        self.assertEqual(decoded,canvas.tobytes())

    def test_names_match_hardware_tile_line_stride(self):
        for ia, width in [(True, 51), (True, 35), (False, 35), (False, 47)]:
            with self.subTest(ia=ia,width=width):
                r=sprite();r.data[48:50]=bytes((3,1) if ia else (4,0))
                canvas=np.zeros((12,64),dtype=np.uint8)
                canvas[:, :width]=np.arange(12,dtype=np.uint8)[:,None]*17
                r.name(0,canvas.tobytes(),12,ia)
                draw,stride=struct.unpack_from('>hh',r.data,72)
                bits=8 if ia else 4
                # This is the game's actual SetTile.line formula.
                hardware_bytes=(draw*bits//8+7)//8*8
                self.assertEqual(stride*bits//8,hardware_bytes)
                pos=r.internal[80]
                linear=swizzle(r.data[pos:pos+hardware_bytes*12],stride,12,bits)
                rows=np.frombuffer(linear,dtype=np.uint8).reshape(12,hardware_bytes)
                self.assertEqual(list(rows[:,0]),list(np.arange(12)*17))

    def test_face_texture_transfer_preserves_uv_islands(self):
        # Two nearly coincident triangles have unrelated UV islands. The
        # closer surface must win without blending across the texture seam.
        vertices=np.array([[0,0,0,0,0],[4,0,0,128,0],[0,4,0,0,128],
                           [0,0,1,128,128],[4,0,1,224,128],[0,4,1,128,224]],dtype=float)
        texture=np.arange(64,dtype=np.uint16).reshape(8,8)*2+1
        sampler=SurfaceSampler(vertices,np.array([[0,1,2],[3,4,5]]),texture)
        result=sampler.sample(np.array([[1,1,.1],[1,1,.9]]))
        np.testing.assert_equal(result,[texture[1,1],texture[5,5]])
        tile=np.frombuffer(sampler.tile(vertices[:3,:3],8),dtype='>u2').reshape(8,8)
        self.assertEqual(tile[1,1],texture[0,0])
        self.assertEqual(tile[1,6],texture[0,4])
        self.assertEqual(tile[6,1],texture[4,0])

    def test_two_cycle_head_combiner_passes_first_cycle_color(self):
        # GBI dRGB1/dAlpha1 must select COMBINED (0), not TEXEL0 (1).
        # In cycle 2, TEXEL0 is the next tile, absent from our one-tile DL.
        from build_rom import patch_model
        raw=bytearray(88)
        struct.pack_into('>I',raw,0,18);struct.pack_into('>I',raw,44,18)
        source='DObjDesc: JointTreeA @ 0x0\nDObjDesc: JointTreeB @ 0x2c'
        parts={12:[(np.zeros((3,3),dtype=int),np.full((3,3),255),(4,bytes(32)))]}
        blob,_,_=patch_model(raw,[0,65535,0,65535,22],source,parts,'')
        words=[b for a,b in struct.iter_unpack('>II',blob[88:]) if a==0xFCFFFFFF and b!=0xFFFE793C]
        self.assertEqual(len(words),1)
        word=words[0]
        self.assertEqual((word>>15)&7,1) # cycle 1: texture color
        self.assertEqual((word>>9)&7,1)  # cycle 1: texture alpha
        self.assertEqual((word>>6)&7,0)  # cycle 2: COMBINED color
        self.assertEqual(word&7,0)      # cycle 2: COMBINED alpha

    def test_adpcm_uses_decoded_feedback_and_preserves_waveform(self):
        # A predictor with one previous-sample tap exercises feedback; the
        # reference decoder is the independently ported RSP algorithm.
        book=[0]*8+[2048]*8
        samples=np.rint(np.sin(np.arange(512)*.12)*16000).astype(np.int16)
        encoded=encode_adpcm(samples,book)
        decoded=np.asarray(decode_vadpcm(encoded,book,2,1))
        self.assertEqual(len(encoded),512//16*9)
        snr=10*np.log10(np.mean(samples.astype(float)**2)/np.mean((decoded-samples)**2))
        self.assertGreater(snr,28)


class AllSlotsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.vpk=Path(os.environ.get('VPK0',str(DECOMP/'tools/vpk0cmd')))
        if not BASE.exists() or not cls.vpk.exists():
            raise unittest.SkipTest('Set VPK0 and provide the owned base ROM for all-slot integration tests')
        cls.rom=BASE.read_bytes()
        cls.entries=[ENTRY.unpack_from(cls.rom,TABLE+i*12) for i in range(COUNT+1)]
        cls.sym=symbols(DECOMP)

    def test_all_twelve_slots_patch_and_keep_external_chains(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            ui=bytearray(b'OSBV'+bytes(12848));ui[10548+24*48+24]=255
            (folder/'ui.osbui').write_bytes(ui)
            for fid in MODELS:
                with self.subTest(model=fid):
                    edits={}
                    def get(i):
                        if i not in edits:
                            e=self.entries[i]
                            data=self.rom[DATA+(e[0]&0x7fffffff):][:e[2]*4]
                            if e[0]>>31:
                                (folder/'a.vpk').write_bytes(data)
                                subprocess.run([str(self.vpk),'d',str(folder/'a.vpk'),str(folder/'a.bin')],check=True,stdout=subprocess.DEVNULL)
                                data=(folder/'a.bin').read_bytes()
                            edits[i]=Reloc(data,chain(data,e[1]),chain(data,e[3]))
                        return edits[i]
                    patches=[]
                    result=patch_ui(dict(model_file=fid,ui='ui.osbui'),folder,get,self.sym,lambda *p:patches.append(p))
                    self.assertTrue(all(result.values()))
                    self.assertEqual(len(patches),4)
                    for reloc in edits.values():
                        extern=dict(reloc.external)
                        data,first,last=reloc.finish()
                        chain(data,first)
                        self.assertEqual(chain(data,last),extern)


class BakedAuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path=Path(os.environ.get('PRESENTATION_ROM',str(ROOT/'build/rom-dimson-casey-v2/opensmash.z64')))
        if not path.exists() or not BASE.exists():
            raise unittest.SkipTest('Build a ROM with presentation assets for corruption tests')
        cls.base=BASE.read_bytes();cls.rom=path.read_bytes()
        cls.loadout=json.loads(path.with_name('loadout.json').read_text())
        cls.fids=[f['model_file'] for f in cls.loadout]

    def test_complete_rom_and_untouched_vanilla_slot(self):
        self.assertTrue(verify(self.base,self.rom,self.fids,self.loadout))
        for t in EMBLEM_TABLES:
            self.assertEqual(self.rom[t+16:t+20],self.base[t+16:t+20]) # Luigi

    def test_rejects_audio_pointer_into_original_bank(self):
        bad=bytearray(self.rom);wt,_,_=voice_info(self.base,0)
        struct.pack_into('>I',bad,CTL+wt,0)
        with self.assertRaises(AssertionError):verify(self.base,bad,self.fids,self.loadout)

    def test_rejects_unselected_emblem_change(self):
        bad=bytearray(self.rom);bad[EMBLEM_TABLES[0]+16]^=1
        with self.assertRaises(AssertionError):verify(self.base,bad,self.fids,self.loadout)

    def test_rejects_bad_presentation_relocation(self):
        bad=bytearray(self.rom);e=ENTRY.unpack_from(bad,TABLE+17*12)
        struct.pack_into('>H',bad,DATA+e[0]+e[1]*4+2,65535)
        with self.assertRaises(AssertionError):verify(self.base,bad,self.fids,self.loadout)


if __name__ == '__main__':
    unittest.main()
