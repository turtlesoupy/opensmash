"""Stage CSS identities alongside injected costumes, never modify the source disc.

OSCS v1 is consumed by runtime/mods/character_select.h. Pages retain Melee's
moveset grid; successive customs sharing a moveset occupy successive pages.
"""
import hashlib
import io
import json
import struct
import uuid
import wave
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from .archive import Archive
from .gx import rgba8
from .character_assets import portrait_path

MAGIC = 0x4F534353
SYMBOL = 'OpenSmashCharacterSelect'
MAX_ENTRIES = 29
SAMPLE_BASE = 0x7000  # Original GALE01 samples occupy 0..1550.


def image_descriptor(a, image):
    p = a.append(rgba8(image), 32)
    descriptor = a.alloc(24)
    a.pointer(descriptor, p)
    a.pack('HHI', descriptor + 4, *image.size, 6)
    return descriptor


def portrait(source, size, label=True):
    info = json.loads((source / 'character.json').read_text())
    with Image.open(portrait_path(source)) as image:
        art = image.convert('RGBA')
    canvas = Image.new('RGBA', size, (22, 27, 43, 255))
    label_height = 12 if label else 0
    art = (ImageOps.contain(art, (size[0], size[1] - label_height), Image.Resampling.LANCZOS) if label
           else ImageOps.fit(art, size, Image.Resampling.LANCZOS, centering=(.5, .4)))
    canvas.alpha_composite(art, ((size[0] - art.width) // 2, size[1] - label_height - art.height))
    if not label:
        return canvas
    text = (info.get('short') or info.get('name') or info['display']).upper()
    try:
        font = ImageFont.truetype('DejaVuSans-Bold.ttf', label_height - 2)
    except OSError:
        font = ImageFont.load_default(size=label_height - 2)
    box = font.getbbox(text)
    label = Image.new('RGBA', (max(1, box[2] - box[0]), max(1, box[3] - box[1])))
    ImageDraw.Draw(label).text((-box[0], -box[1]), text, font=font, fill='white')
    label.thumbnail((size[0] - 4, label_height - 2), Image.Resampling.LANCZOS)
    canvas.alpha_composite(label, ((size[0] - label.width) // 2, size[1] - label_height + 1))
    return canvas


def dsp_clip(path, cache=None, *, trim=False):
    """Encode Nintendo DSP ADPCM with a deterministic first-order predictor.

    Source announcers are short mono PCM recordings. Search each block's scale
    and predictor rather than truncating samples or changing their pitch.
    The optional cache is keyed by WAV content and encoding version, so edited
    recordings invalidate it. Bump the version if the encoding format changes.
    """
    raw = Path(path).read_bytes()
    try:
        stream = wave.open(io.BytesIO(raw), 'rb')
    except (wave.Error, EOFError) as error:
        raise ValueError('Invalid announcer PCM WAV') from error
    with stream as wav:
        channels, width, rate, count = wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getnframes()
        if width != 2 or channels not in (1, 2) or not 8000 <= rate <= 48000 or not 0 < count <= rate * 15:
            raise ValueError('Announcer must be a mono/stereo 16-bit PCM WAV, at most 15 seconds')
        samples = np.frombuffer(wav.readframes(count), dtype='<i2').reshape(-1, channels).mean(axis=1).tolist()
    if trim:
        # Remove only quiet edges; retain 15 ms around speech and all internal pauses.
        signal = np.asarray(samples)
        audible = np.flatnonzero(np.abs(signal) > max(32, np.max(np.abs(signal)) * .005))
        if len(audible):
            padding = rate * 15 // 1000
            samples = samples[max(0, int(audible[0]) - padding):min(count, int(audible[-1]) + padding + 1)]
            count = len(samples)
    coefficients = [(0, 0), (2048, 0), (4096, -2048), (3072, -1024)] + [(0, 0)] * 4
    cached = None
    if cache is not None:
        cached = Path(cache) / (hashlib.sha256(b'opensmash-dsp-v2\0' + bytes([trim]) + raw).hexdigest() + '.dsp')
        try:
            stored = cached.read_bytes()
            data = stored[32:]
            if len(data) == ((count + 13) // 14) * 8 and stored[:32] == hashlib.sha256(data).digest():
                return data, rate, count, coefficients
        except OSError:
            pass
    data = encode_dsp(samples, coefficients)
    if cached is not None:
        temporary = cached.with_suffix('.' + uuid.uuid4().hex + '.tmp')
        try:
            cached.parent.mkdir(parents=True, exist_ok=True)
            temporary.write_bytes(hashlib.sha256(data).digest() + data)
            temporary.replace(cached)
        except OSError:
            pass  # An unwritable cache must not prevent a match from starting.
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    return data, rate, count, coefficients


def encode_dsp(samples, coefficients):
    encoded = bytearray()
    history = [0, 0]
    for start in range(0, len(samples), 14):
        block = samples[start:start + 14]
        block += [0] * (14 - len(block))
        best = None
        for predictor, (c1, c2) in enumerate(coefficients[:4]):
            # A bounded 13-scale search gives reproducible audio on every host.
            for scale in range(13):
                h1, h2 = history
                error, nibbles = 0, []
                step = 1 << scale
                for value in block:
                    predicted = (c1 * h1 + c2 * h2 + 1024) >> 11
                    quantized = round((value - predicted) / step)
                    quantized = -8 if quantized < -8 else 7 if quantized > 7 else quantized
                    decoded = predicted + (quantized << scale)
                    decoded = -32768 if decoded < -32768 else 32767 if decoded > 32767 else decoded
                    error += (value - decoded) ** 2
                    # Squared error only increases; this candidate cannot win.
                    if best is not None and error >= best[0]:
                        break
                    nibbles.append(quantized & 15)
                    h2, h1 = h1, decoded
                if best is None or error < best[0]:
                    best = error, predictor, scale, nibbles, [h1, h2]
        _, predictor, scale, nibbles, history = best
        encoded.append((predictor << 4) | scale)
        encoded.extend((nibbles[i] << 4) | nibbles[i + 1] for i in range(0, 14, 2))
    return bytes(encoded)


def extend_sound_bank(raw, sources, *, clips=None):
    header_size, sample_size, count, base = struct.unpack_from('>4I', raw)
    base = SAMPLE_BASE  # Do not collide with nr_1p.ssm when modes share banks.
    sample_start = (header_size + 16 + 31) & ~31
    if sample_start + sample_size != len(raw):
        raise ValueError('Invalid announcer sound bank')
    headers = bytearray(raw[16:16 + header_size])
    samples = bytearray(raw[sample_start:])
    ids = []
    for source in sources:
        data, rate, frames, coefficients = clips[source] if clips is not None else dsp_clip(source / 'announcer.wav')
        samples.extend(bytes(-len(samples) % 32))
        offset = len(samples) * 2
        samples.extend(data)
        samples.extend(bytes(-len(samples) % 32))
        # SSM entry: channel count/rate, AXPBADDR, ADPCM coefficients/state,
        # loop state. Addresses are nibbles relative to the bank's ARAM base.
        entry = bytearray(72)
        end = offset + ((frames - 1) // 14) * 16 + (frames - 1) % 14 + 2
        struct.pack_into('>IIHHIII', entry, 0, 1, rate, 0, 0, offset + 2, end, offset + 2)
        struct.pack_into('>16h', entry, 24, *(c for pair in coefficients for c in pair))
        struct.pack_into('>HHhh', entry, 56, 0, data[0], 0, 0)
        headers.extend(entry)
        ids.append(base + count)
        count += 1
    result = struct.pack('>4I', len(headers), len(samples), count, base) + headers
    result += bytes(-len(result) % 32)
    return result + samples, ids


def arrow_joint(a, direction):
    # Flat, unlit geometry in the two empty lower-row corners of Melee's grid.
    vertices = [(direction * x, y, 0) for x, y in [(-1.5, 2), (1.5, 0), (-1.5, -2)]]
    positions = a.append(struct.pack('>9f', *(v for p in vertices for v in p)), 32)
    attrs = a.alloc(48)
    a.pack('4I', attrs, 9, 3, 1, 4)
    a.pack('H', attrs + 18, 12)
    a.pointer(attrs + 20, positions)
    a.pack('I', attrs + 24, 255)
    dl = a.append(struct.pack('>B4H', 0x90, 3, 0, 1, 2) + bytes(23), 32)
    poly = a.alloc(24)
    a.pointer(poly + 8, attrs)
    a.pack('HH', poly + 12, 0, 1)
    a.pointer(poly + 16, dl)
    material = a.alloc(20)
    a.pack('IIIff', material, 0xFFE08AFF, 0xFFE08AFF, 0, 1., 0.)
    mobj = a.alloc(24)
    a.pack('I', mobj + 4, 1)  # constant material color
    a.pointer(mobj + 12, material)
    dobj = a.alloc(16)
    a.pointer(dobj + 8, mobj)
    a.pointer(dobj + 12, poly)
    joint = a.alloc(64)
    a.pack('I', joint + 4, 1 << 18)  # opaque render pass
    a.pointer(joint + 16, dobj)
    a.pack('3f', joint + 32, 1, 1, 1)
    a.pack('3f', joint + 44, direction * 27, 2.5, 0)
    return joint


def extend_menu(raw, entries, sound_ids, durations=None):
    a = Archive(raw)
    if SYMBOL in a.roots():
        raise ValueError('Character select must be staged from the original menu')
    record = a.alloc(16 + len(entries) * 32)
    a.pack('4I', record, MAGIC, 1, len(entries), 0)
    pages = {}
    for i, (entry, sound) in enumerate(zip(entries, sound_ids, strict=True)):
        fighter, color, source = entry
        pages[fighter] = pages.get(fighter, 0) + 1
        row = record + 16 + i * 32
        a.pack('4I', row, fighter, color, pages[fighter], sound)
        a.pack('I', row + 28, durations[source] if durations else 2500)
        a.pointer(row + 16, image_descriptor(a, portrait(source, (64, 56))))
        a.pointer(row + 20, image_descriptor(a, portrait(source, (160, 192), label=False)))
        info = json.loads((source / 'character.json').read_text())
        name = info.get('name') or info['display']
        # The game font expects Shift-JIS full-width Latin glyphs.
        name = ''.join(chr(ord(c) + 0xFEE0) if '!' <= c <= '~' else '\u3000' if c == ' ' else c for c in name)
        a.pointer(row + 24, a.append(name.encode('shift_jis', errors='replace') + b'\0'))
    a.pack('I', record + 12, max(pages.values(), default=0) + 1)
    # Append children, preserving all original joint indices and animations.
    table = a.roots()['MnSelectChrDataTable']
    for offset in (64, 112):  # ANIM[3] VS / ANIM[6] 1P; ANIM begins at +16.
        root = a.ptr(table + offset)
        a.pack('I', root + 4, a.u32(root + 4) | (1 << 28))
        last = a.ptr(root + 8)
        while a.ptr(last + 12) is not None:
            last = a.ptr(last + 12)
        for direction in (-1, 1):
            joint = arrow_joint(a, direction)
            a.pointer(last + 12, joint)
            last = joint
    a.public.append((record, len(a.strings)))
    a.strings += SYMBOL.encode() + b'\0'
    return a.serialize()


def character_select_assets(game, entries, *, cache=None):
    """Entries are (external fighter ID, costume color, validated source folder)."""
    if not entries:
        return {}
    from .costume_variant import SCHEMA
    if len(entries) > MAX_ENTRIES:
        raise ValueError('Too many injected character slots')
    seen = set()
    normalized = []
    for fighter, color, source in entries:
        slots = SCHEMA['costumes'].get(str(fighter), [])
        if type(color) is not int or not 0 <= color < len(slots) or (fighter, color) in seen:
            raise ValueError('Invalid or duplicate injected character slot')
        seen.add((fighter, color))
        normalized.append((fighter, color, Path(source)))
    game = Path(game)
    # Cache the finished menus and sound banks, not just the DSP clips. Hash
    # source contents so edits, reordered slots, and a new disc invalidate it.
    names = ('audio/nr_select.ssm', 'audio/us/nr_select.ssm', 'MnSlChr.dat', 'MnSlChr.usd')
    cached = None
    if cache is not None:
        digest = hashlib.sha256(b'opensmash-character-select-assets-v3\0')
        def add(raw):
            digest.update(len(raw).to_bytes(8, 'big'))
            digest.update(raw)
        for name in names:
            add((game / 'files' / name).read_bytes())
        for fighter, color, source in normalized:
            add(bytes((fighter, color)))
            for file in (source / 'character.json', portrait_path(source), source / 'announcer.wav'):
                add(file.read_bytes())
        cached = Path(cache) / ('select-' + digest.hexdigest() + '.zip')
        try:
            with zipfile.ZipFile(cached) as archive:
                return {name: archive.read(name) for name in names}
        except (OSError, zipfile.BadZipFile, KeyError, EOFError):
            pass
    # Build all outputs before replacing any staged hard links.
    outputs = {}
    sources = list(dict.fromkeys(e[2] for e in normalized))
    clips = {source: dsp_clip(source / 'announcer.wav', cache, trim=True) for source in sources}
    for suffix in ('', 'us/'):
        path = game / 'files/audio' / suffix / 'nr_select.ssm'
        outputs[path], ids = extend_sound_bank(path.read_bytes(), [e[2] for e in normalized], clips=clips)
        menu = game / ('files/MnSlChr.usd' if suffix else 'files/MnSlChr.dat')
        outputs[menu] = extend_menu(menu.read_bytes(), normalized, ids,
                                    {source: (clip[2] * 1000 + clip[1] - 1) // clip[1]
                                     for source, clip in clips.items()})
    result = {path.relative_to(game / 'files').as_posix(): data for path, data in outputs.items()}
    if cached is not None:
        temporary = cached.with_suffix('.' + uuid.uuid4().hex + '.tmp')
        try:
            cached.parent.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(temporary, 'w') as archive:
                for name, data in result.items():
                    archive.writestr(name, data)
            temporary.replace(cached)
        except OSError:
            pass
        finally:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                pass
    return result


def stage_character_select(game, entries, *, cache=None):
    for name, data in character_select_assets(game, entries, cache=cache).items():
        path = Path(game) / 'files' / name
        path.unlink()  # The staging tree can contain hard links to the source disc.
        path.write_bytes(data)


def catalog_identities(root, catalog, costumes):
    from .costume_variant import SCHEMA
    import hashlib
    if not isinstance(costumes, list) or len(costumes) > 8:
        raise ValueError('Invalid character select lineup')
    from .targets import PLAYABLE, cache_id
    kinds = {slug:row['fighter'] for slug,row in PLAYABLE.items()}
    entries, seen = [], set()
    for c in costumes:
        if isinstance(c,dict) and c.get("companion") and c.get("target")=="nana": continue
        if not isinstance(c, dict):
            raise ValueError('Invalid character select entry')
        row = catalog.get(c.get('character'))
        fighter, color = c.get('fighter'), c.get('color')
        if not row or type(fighter) is not int or fighter != kinds.get(c.get('target',row['target'])):
            raise ValueError('Unknown injected fighter')
        slots = SCHEMA['costumes'][str(fighter)]
        if type(color) is not int or not 0 <= color < len(slots) or c.get('filename') != slots[color]['filename'] or (fighter, color) in seen:
            raise ValueError('Invalid injected costume slot')
        seen.add((fighter, color))
        ident = cache_id(row['slug'],c.get('target',row['target']),row.get('original_target', row['target']))
        entries.append((fighter, color, Path(root) / 'assets/characters' / ident))
    return entries
