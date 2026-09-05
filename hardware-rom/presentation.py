"""NTSC-U ROM presentation assets: reloc sprites and streamed VADPCM voices."""
import math
import re
import struct
import sys
import wave
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pipeline.render_announcer_refs import (FGM_TABLE, FGM_UCODE, package_entries,
                                          resolve_table, resolve_ucode)
from pipeline.dump_fgm_bank import Ctl, decode_vadpcm

TITLES = ['Mario', 'Fox', 'Donkey', 'Samus', 'Luigi', 'Link', 'Yoshi', 'Captain', 'Kirby', 'Pikachu', 'Purin', 'Ness']
MODELS = [296, 313, 317, 320, 323, 324, 338, 332, 328, 341, 330, 335]
EMBLEMS = [0x618, 0x1938, 0xc78, 0x12d8, 0x618, 0x25f8, 0x2c58, 0x32b8, 0x1f98, 0x3918, 0x3918, 0x3f78]
# Per-fighter tables in VS, 1P, training and bonus overlays. Unlike the stage
# series table, these must distinguish Mario/Luigi and Pikachu/Jigglypuff.
EMBLEM_TABLES = [0x13988c, 0x140ba4, 0x147794, 0x14d2f4]
NAME_FGMS = [499, 486, 483, 513, 498, 497, 535, 485, 496, 507, 508, 501]
MENU_SCALE_TABLE = 0x108370  # dSCSubsysFighterScales; menus/results only
CTL, CTL_SIZE, TBL = 0xC6B650, 0xFBA0, 0xC7B1F0


def symbols(decomp):
    # The decomp header carries absolute linker-symbol offsets, not addresses.
    candidates = [decomp.parent/'tools/reloc_data_symbols.us.txt', decomp/'relocData.us.ld',
                  decomp/'linker/relocData.us.ld']
    for p in candidates:
        if p.exists():
            found = dict((k, int(v, 16)) for k, v in re.findall(r'(\w+)\s*=\s*(0x[0-9a-fA-F]+)\s*;', p.read_text()))
            if 'llCharacterNamesMarioSprite' in found:
                return found
    # Standalone decomp checkouts keep the same constants in generated headers.
    for p in decomp.glob('**/reloc_data*.h'):
        found = dict((k, int(v, 16)) for k, v in re.findall(r'#define\s+(\w+)\s+(0x[0-9a-fA-F]+)', p.read_text()))
        if 'llCharacterNamesMarioSprite' in found:
            return found
    raise ValueError('Cannot find NTSC-U reloc sprite symbols in decomp checkout')


def swizzle(data, width, height, bits):
    """N64 ROM byte order (OSBV preencoded buffers additionally reverse u32s)."""
    row = width * bits // 8
    out = bytearray(data)
    for y in range(1, height, 2):
        for x in range(row):
            out[y*row+x] = data[y*row+(x ^ (8 if bits == 32 else 4))]
    return bytes(out)


def unword(data):
    if len(data) % 4:
        raise ValueError('Unaligned OSBV buffer')
    return b''.join(data[i:i+4][::-1] for i in range(0, len(data), 4))


class Reloc:
    def __init__(self, raw, internal, external):
        self.data = bytearray(raw)
        self.internal = dict(internal)
        self.external = dict(external)

    def append(self, data):
        self.data.extend(b'\0' * (-len(self.data) % 8))
        at = len(self.data)
        self.data.extend(data)
        return at

    def strips(self, sprite):
        n = struct.unpack_from('>h', self.data, sprite+40)[0]
        if not 1 <= n <= 8:
            raise ValueError('Invalid sprite strip count')
        bm = self.internal[sprite+52]
        return [bm+i*16 for i in range(n)]

    def clone_sprite(self, source):
        """Copy sprite and bitmaps; preserve every relocation, including DLs."""
        data = self.data
        size = len(self.strips(source))*16
        bm = self.internal[source+52]
        clone = self.append(data[source:source+68])
        new_bm = self.append(data[bm:bm+size])
        for pointers in (self.internal, self.external):
            for at, target in list(pointers.items()):
                if source <= at < source+68:
                    pointers[clone+at-source] = target
                if bm <= at < bm+size:
                    pointers[new_bm+at-bm] = target
        self.internal[clone+52] = new_bm
        for old, new in zip(self.strips(source), self.strips(clone)):
            width, height = struct.unpack_from('>h', data, old+2)[0], struct.unpack_from('>h', data, old+12)[0]
            bits = 4 << data[source+49]
            pos = self.internal[old+8]
            self.internal[new+8] = self.append(data[pos:pos+width*height*bits//8])
        return clone

    def encoded(self, sprite, encoded, fmt, bits):
        if tuple(self.data[sprite+48:sprite+50]) != (fmt, int(math.log2(bits//4))):
            raise ValueError('Unexpected sprite format')
        at = 0
        for bm in self.strips(sprite):
            w = struct.unpack_from('>h', self.data, bm+2)[0]
            h = struct.unpack_from('>h', self.data, bm+12)[0]
            n = w*h*bits//8
            pos = self.internal[bm+8]
            if at+n > len(encoded):
                raise ValueError('OSBV sprite dimensions do not match ROM')
            self.data[pos:pos+n] = encoded[at:at+n]
            at += n
        if at != len(encoded):
            raise ValueError('Unexpected trailing sprite bytes')

    def name(self, sprite, canvas, height, ia):
        strips = self.strips(sprite)
        if len(strips) != 1 or tuple(self.data[sprite+48:sprite+50]) != ((3, 1) if ia else (4, 0)):
            raise ValueError('Unexpected name sprite format')
        # lbCommonDrawSObjBitmap derives TMEM line stride from Bitmap.width,
        # not width_img. Match that rounded stride exactly (8 bytes/row).
        arr = np.frombuffer(canvas, dtype=np.uint8).reshape(height, 64)
        ink = np.nonzero((arr & 15) if ia else arr)[1]
        width = max(1, int(ink.max())+1) if len(ink) else 1
        alignment = 8 if ia else 16
        stride = (width+alignment-1)//alignment*alignment
        arr = arr[:, :stride].copy()
        if ia:
            texels = arr.tobytes()
        else:
            nib = arr >> 4
            texels = ((nib[:, ::2] << 4) | nib[:, 1::2]).tobytes()
        bm = strips[0]
        struct.pack_into('>hh', self.data, sprite+4, width, height)
        struct.pack_into('>hh', self.data, bm, width, stride)
        self.internal[bm+8] = self.append(swizzle(texels, stride, height, 8 if ia else 4))

    def emblem(self, sprite, canvas):
        if tuple(self.data[sprite+48:sprite+50]) != (4, 0) or len(self.strips(sprite)) != 1:
            raise ValueError('Unexpected emblem sprite format')
        bm = self.strips(sprite)[0]
        w = struct.unpack_from('>h', self.data, bm+2)[0]
        h = struct.unpack_from('>h', self.data, bm+12)[0]
        dw, dh = struct.unpack_from('>hh', self.data, sprite+4)
        pos = self.internal[bm+8]
        packed = np.frombuffer(swizzle(self.data[pos:pos+w*h//2], w, h, 4), dtype=np.uint8).reshape(h, w//2)
        old = np.stack((packed >> 4, packed & 15), axis=2).reshape(h, w)
        vy, vx = np.nonzero(old[:dh, :dw]); cy, cx = np.nonzero(canvas)
        if not len(cx):
            raise ValueError('Empty emblem canvas')
        x0, y0 = (int(vx.min()), int(vy.min())) if len(vx) else (0, 0)
        vw, vh = (int(vx.max())-x0+1, int(vy.max())-y0+1) if len(vx) else (dw, dh)
        crop = canvas[cy.min():cy.max()+1, cx.min():cx.max()+1]
        scale = min(vw/crop.shape[1], vh/crop.shape[0])
        ow, oh = max(1, int(crop.shape[1]*scale+.5)), max(1, int(crop.shape[0]*scale+.5))
        ox, oy = x0+(vw-ow)//2, y0+(vh-oh)//2
        resized = crop[np.minimum((np.arange(oh)/scale).astype(int), crop.shape[0]-1)[:, None],
                       np.minimum((np.arange(ow)/scale).astype(int), crop.shape[1]-1)]
        out = np.zeros((h, w), dtype=np.uint8)
        out[oy:oy+oh, ox:ox+ow] = (resized.astype(np.uint16)*max(1, int(old.max()))+127)//255
        self.data[pos:pos+w*h//2] = swizzle(((out[:, ::2]<<4)|out[:, 1::2]).tobytes(), w, h, 4)

    def finish(self):
        self.data.extend(b'\0' * (-len(self.data) % 4))
        if len(self.data) > 0xffff*4:
            raise ValueError('Presentation exceeds reloc file size limit')
        for pointers, sort in [(self.internal, True), (self.external, False)]:
            offsets = sorted(pointers) if sort else list(pointers)
            for i, at in enumerate(offsets):
                target = pointers[at]
                if target % 4 or target//4 > 0xffff:
                    raise ValueError('Invalid presentation relocation')
                struct.pack_into('>HH', self.data, at, offsets[i+1]//4 if i+1<len(offsets) else 0xffff, target//4)
        return self.data, min(self.internal)//4 if self.internal else 0xffff, next(iter(self.external))//4 if self.external else 0xffff


def patch_ui(fighter, assets, get, sym, patch):
    ui = (assets/fighter['ui']).read_bytes()
    if ui[:4] != b'OSBV' or len(ui) < 10548:
        raise ValueError('ROM UI requires an OSBV pack; regenerate legacy UI assets')
    fk = MODELS.index(fighter['model_file']); title = TITLES[fk]
    portrait = get(19)
    portrait.encoded(sym['llMNPlayersPortraits'+title+'Sprite'], unword(ui[4:8644]), 0, 32)
    name = {'Donkey':'DK', 'Captain':'CaptainFalcon', 'Purin':'Jigglypuff'}.get(title, title)
    get(17).name(sym['llMNPlayersCommon'+name+'TextSprite'], ui[8644:9668], 16, True)
    get(12).name(sym['llCharacterNames'+title+'Sprite'], ui[9780:10548], 12, False)
    model = get(319 if fk == 2 else MODELS[fk])
    prefix = 'llDkIcon' if fk == 2 else 'll'+title+'Model'
    stock = sym[prefix+'StockSprite']
    model.encoded(stock, unword(ui[9668:9748]), 2, 4)
    # Costume palettes precede the stock Sprite/Bitmap. The first palette is
    # the Sprite's LUT; every subsequent 40-byte frame is selected by Main.
    pal = model.internal[stock+32]
    bm = model.strips(stock)[0]
    if (bm-pal-32) % 40 or not 1 <= (bm-pal+8)//40 <= 8:
        raise ValueError('Unrecognized stock costume palette layout')
    for at in range(pal, bm-31, 40):
        model.data[at:at+32] = unword(ui[9748:9780])
    emblem = len(ui) >= 12852 and any(ui[10548:12852])
    if emblem:
        canvas = np.frombuffer(ui[10548:12852], dtype=np.uint8).reshape(48,48)
        model.emblem(sym[prefix+'FTEmblemSprite'], canvas)
        menu = get(20)
        clone = menu.clone_sprite(EMBLEMS[fk])
        menu.emblem(clone, canvas)
        for table in EMBLEM_TABLES:
            patch(table+fk*4, struct.pack('>I', EMBLEMS[fk]), struct.pack('>I', clone))
    return {'names': True, 'portrait': True, 'stock': True, 'emblem': emblem}


def voice_info(rom, fk):
    tables = package_entries(rom[FGM_TABLE[0]:sum(FGM_TABLE)])
    ucode = package_entries(rom[FGM_UCODE[0]:sum(FGM_UCODE)])
    table, cents = resolve_ucode(ucode[NAME_FGMS[fk]])
    sample, tuning = resolve_table(tables[table])
    ctl = rom[CTL:CTL+CTL_SIZE]
    u32 = lambda off: struct.unpack_from('>I', ctl, off)[0]
    inst = u32(u32(4)+12)
    sound = u32(inst+16+sample*4)
    wt = u32(sound+8)
    count = struct.unpack_from('>h', ctl, inst+14)[0]
    if sum(u32(u32(inst+16+i*4)+8) == wt for i in range(count)) != 1:
        raise ValueError('Announcer wavetable is shared with another sound')
    info = Ctl(ctl, b'').wavetable(wt)
    if info['loop'] or info['type'] != 0 or info['order'] != 2:
        raise ValueError('Unexpected announcer wavetable')
    return wt, info, int(2**((cents+tuning)/1200)*32768)/32768


def encode_adpcm(samples, book):
    """Encode against the original ROM codebook with decoded-history feedback.

    Search predictors and scales for each 16-sample frame; use the exact RSP
    fixed-point reconstruction when scoring. Keeping its book leaves CTL size
    and DMA/decode behavior unchanged (this game's pull path is ADPCM-only).
    """
    predictors = np.asarray(book).reshape(-1, 2, 8).tolist()
    samples = list(map(int, samples))
    samples += [0]*(-len(samples)%16)
    history = [0, 0]
    encoded = bytearray()
    for at in range(0, len(samples), 16):
        frame = samples[at:at+16]
        best = None
        for pi, (t0,t1) in enumerate(predictors):
            # Estimate residual scale, then search adjacent scales with exact
            # feedback. Large residuals clamp at the RSP's maximum shift 12.
            residual = []
            prev = history + frame
            for j in range(16):
                residual.append(frame[j] - ((t0[0]*prev[j]+t1[0]*prev[j+1]) >> 11))
            estimate = max(0, min(12, math.ceil(math.log2(max(1, max(map(abs,residual)))/7))))
            for shift in range(max(0, estimate-1), min(12, estimate+1)+1):
                decoded = history.copy(); nibbles=[]; error=0
                for half in (0,8):
                    p2,p1 = decoded[-2:]; ins=[]
                    for j in range(8):
                        pred = t0[j]*p2+t1[j]*p1+sum(t1[j-k-1]*ins[k] for k in range(j))
                        q = max(-8,min(7,round((frame[half+j]-pred/2048)/(1<<shift))))
                        ins.append(q*(1<<shift))
                        value = max(-32768,min(32767,(pred+(ins[-1]<<11))>>11))
                        decoded.append(value); nibbles.append(q & 15)
                        error += (frame[half+j]-value)**2
                if best is None or error < best[0]:
                    best = (error, pi, shift, nibbles, decoded[-2:])
        _, pi, shift, nibbles, history = best
        encoded.append((shift<<4)|pi)
        encoded.extend((nibbles[j]<<4)|nibbles[j+1] for j in range(0,16,2))
    return bytes(encoded)


def bake_voice(original, output, fighter, assets, patch):
    fk = MODELS.index(fighter['model_file'])
    wt, info, ratio = voice_info(original, fk)
    with wave.open(str(assets/fighter['voice']), 'rb') as wav:
        if wav.getsampwidth() != 2 or wav.getcomptype() != 'NONE' or wav.getnchannels() not in (1,2):
            raise ValueError('Announcer must be mono/stereo PCM16 WAV')
        rate = wav.getframerate()
        samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2').reshape(-1,wav.getnchannels()).mean(axis=1)
    # FGM resamples at this ratio into a 32 kHz mix, independent of bank rate.
    target_rate = round(32000*ratio)
    divisor = math.gcd(target_rate,rate)
    source = np.clip(np.rint(resample_poly(samples,target_rate//divisor,rate//divisor)), -32768,32767).astype(np.int16)
    data = encode_adpcm(source, info['book'])
    decoded = np.asarray(decode_vadpcm(data,info['book'],info['order'],info['npredictors']))[:len(source)]
    noise = np.mean((source.astype(float)-decoded)**2)
    snr = 10*math.log10(max(1,float(np.mean(source.astype(float)**2)))/max(noise,1e-9))
    output.extend(b'\0' * (-len(output)%16))
    offset = len(output); output.extend(data)
    output.extend(b'\0'*32)  # Safe trailing DMA padding.
    patch(CTL+wt, original[CTL+wt:CTL+wt+8], struct.pack('>II',offset-TBL,len(data)))
    return {'announcer':True, 'rom_offset':offset, 'encoded_bytes':len(data),
            'seconds':round(len(source)/(32000*ratio),3), 'encoding_snr_db':round(snr,2)}
