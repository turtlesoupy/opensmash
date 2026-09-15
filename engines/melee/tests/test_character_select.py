import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch
import wave

import numpy as np
from PIL import Image
from opensmash_melee.archive import Archive
from opensmash_melee.character_select import (catalog_identities, dsp_clip,
    character_select_assets, extend_menu, extend_sound_bank, SYMBOL, SAMPLE_BASE)

ROOT = Path(__file__).resolve().parents[1]


class CharacterSelectTests(unittest.TestCase):
    def test_finished_assets_cache_reuses_and_invalidates_inputs(self):
        game = self.source / 'game'
        names = ('audio/nr_select.ssm', 'audio/us/nr_select.ssm', 'MnSlChr.dat', 'MnSlChr.usd')
        for name in names:
            file = game / 'files' / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'original')
        cache = self.source / 'cache'
        entries = [(8, 1, self.source)]
        with patch('opensmash_melee.character_select.extend_menu', return_value=b'menu') as menu, \
             patch('opensmash_melee.character_select.extend_sound_bank', return_value=(b'bank', [1])):
            first = character_select_assets(game, entries, cache=cache)
            self.assertEqual(menu.call_count, 2)
            self.assertEqual(character_select_assets(game, entries, cache=cache), first)
            self.assertEqual(menu.call_count, 2)
            for file, data in ((self.source / 'character.json', b'{"display":"Renamed"}'),
                               (game / 'files/MnSlChr.dat', b'new disc menu')):
                file.write_bytes(data)
                character_select_assets(game, entries, cache=cache)
            self.assertEqual(menu.call_count, 6)
            Image.new('RGBA', (80, 100), 'blue').save(self.source / 'portrait_raw.png')
            character_select_assets(game, entries, cache=cache)
            self.assertEqual(menu.call_count, 8)
            character_select_assets(game, [(8, 2, self.source)], cache=cache)
            self.assertEqual(menu.call_count, 10)
            for file in cache.glob('select-*.zip'):
                file.write_bytes(b'interrupted write')
            self.assertEqual(character_select_assets(game, entries, cache=cache), first)
            self.assertEqual(menu.call_count, 12)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name)
        (self.source / 'character.json').write_text(json.dumps({'display': 'Test Fighter', 'short': 'TEST'}))
        Image.new('RGBA', (80, 100), 'red').save(self.source / 'portrait_raw.png')
        self.samples = (np.sin(np.arange(3200) * .12) * 12000).astype('<i2')
        with wave.open(str(self.source / 'announcer.wav'), 'wb') as wav:
            wav.setparams((1, 2, 32000, 0, 'NONE', 'not compressed'))
            wav.writeframes(self.samples.tobytes())

    def test_announcer_trims_only_quiet_edges(self):
        voice = np.concatenate([np.full(1600, 8000), np.zeros(3200), np.full(1600, -8000)]).astype('<i2')
        padded = np.concatenate([np.zeros(3200), voice, np.zeros(6400)]).astype('<i2')
        path = self.source / 'padded.wav'
        with wave.open(str(path), 'wb') as wav:
            wav.setparams((1, 2, 32000, len(padded), 'NONE', 'not compressed'))
            wav.writeframes(padded.tobytes())
        cache = self.source / 'trim-cache'
        original = dsp_clip(path, cache)
        trimmed = dsp_clip(path, cache, trim=True)
        self.assertEqual(original[2], len(padded))
        self.assertEqual(trimmed[1:3], (32000, len(voice) + 960))
        self.assertEqual(trimmed, dsp_clip(path, cache, trim=True))

    def test_announcer_roundtrip_preserves_duration_rate_and_signal(self):
        raw, rate, count, coefficients = dsp_clip(self.source / 'announcer.wav')
        decoded, h1, h2 = [], 0, 0
        for start in range(0, len(raw), 8):
            block = raw[start:start + 8]
            c1, c2 = coefficients[block[0] >> 4]
            scale = 1 << (block[0] & 15)
            for byte in block[1:]:
                for n in (byte >> 4, byte & 15):
                    if n >= 8: n -= 16
                    value = max(-32768, min(32767, ((c1 * h1 + c2 * h2 + 1024) >> 11) + n * scale))
                    decoded.append(value)
                    h2, h1 = h1, value
        self.assertEqual((rate, count), (32000, len(self.samples)))
        error = np.mean((np.array(decoded[:count]) - self.samples.astype(float)) ** 2)
        self.assertGreater(10 * np.log10(np.mean(self.samples.astype(float) ** 2) / error), 35)

    def test_sound_bank_preserves_existing_entries_and_samples(self):
        header = bytes(72)
        samples = bytes(range(32))
        original = struct.pack('>4I', 72, 32, 1, 100) + header + bytes(8) + samples
        raw, ids = extend_sound_bank(original, [self.source, self.source])
        size, sample_size, count, base = struct.unpack_from('>4I', raw)
        self.assertEqual(ids, [SAMPLE_BASE + 1, SAMPLE_BASE + 2])
        self.assertEqual((count, base), (3, SAMPLE_BASE))
        self.assertEqual(raw[16:88], header)
        start = (size + 16 + 31) & ~31
        self.assertEqual(raw[start:start + 32], samples)
        self.assertEqual(start + sample_size, len(raw))
        for index in range(2):
            entry = 16 + 72 * (index + 1)
            self.assertEqual(struct.unpack_from('>II', raw, entry), (1, 32000))
            loop, end, current = struct.unpack_from('>III', raw, entry + 12)
            self.assertEqual(loop, current)
            self.assertLess(current, end)
            self.assertLess(end, sample_size * 2)

    def test_encoder_matches_original_bytes_for_mono_and_stereo(self):
        # Golden outputs from the original exhaustive encoder: silence, clipping,
        # fractional stereo averages, predictor ties, and an incomplete block.
        digests = ['03c72c70e669fcad8908aa0221d9838ad61dac6ea5631abc62d78007887c3044',
                   'e4657cbafec760efcfb4676c35b613595965120d172e84d6f242693759152f35']
        path = self.source / 'golden.wav'
        for channels, digest in enumerate(digests, 1):
            samples = np.array(([0] * 28 + [-32768, 32767, 1, -1, 0, 2, -2] +
                                [((i * 7919) % 65536) - 32768 for i in range(65)]) * channels, dtype='<i2')
            with wave.open(str(path), 'wb') as wav:
                wav.setparams((channels, 2, 32000, 0, 'NONE', 'not compressed'))
                wav.writeframes(samples.tobytes())
            self.assertEqual(hashlib.sha256(dsp_clip(path)[0]).hexdigest(), digest)

    def test_audio_cache_reuses_content_and_recovers_from_corruption(self):
        path, cache = self.source / 'announcer.wav', self.source / 'cache'
        expected = dsp_clip(path, cache)
        with patch('opensmash_melee.character_select.encode_dsp', side_effect=AssertionError('Re-encoded cached audio')):
            self.assertEqual(dsp_clip(path, cache), expected)
        next(cache.glob('*.dsp')).write_bytes(b'corrupt')
        self.assertEqual(dsp_clip(path, cache), expected)
        # Same path and length, different PCM: must not reuse the old encoding.
        with wave.open(str(path), 'wb') as wav:
            wav.setparams((1, 2, 32000, 0, 'NONE', 'not compressed'))
            wav.writeframes(bytes(len(self.samples) * 2))
        self.assertNotEqual(dsp_clip(path, cache)[0], expected[0])
        self.assertEqual(len(list(cache.glob('*.dsp'))), 2)

    def test_unwritable_cache_does_not_prevent_encoding(self):
        path = self.source / 'announcer.wav'
        expected = dsp_clip(path)
        with patch.object(Path, 'mkdir', side_effect=PermissionError('Read only')):
            self.assertEqual(dsp_clip(path, self.source / 'cache'), expected)

    def test_regional_banks_share_one_encode_per_source(self):
        game = self.source / 'game'
        bank = struct.pack('>4I', 72, 32, 1, 100) + bytes(72 + 8 + 32)
        for suffix, menu in [('', 'MnSlChr.dat'), ('us/', 'MnSlChr.usd')]:
            path = game / 'files/audio' / suffix / 'nr_select.ssm'
            path.parent.mkdir(parents=True)
            path.write_bytes(bank)
            (game / 'files' / menu).write_bytes(b'menu')
        with patch('opensmash_melee.character_select.dsp_clip', wraps=dsp_clip) as encode:
            with patch('opensmash_melee.character_select.extend_menu', return_value=b'extended'):
                outputs = character_select_assets(game, [(8, 1, self.source), (8, 2, self.source)])
        self.assertEqual(encode.call_count, 1)
        self.assertEqual(len(outputs), 4)
        self.assertEqual(outputs['audio/nr_select.ssm'], outputs['audio/us/nr_select.ssm'])

    @unittest.skipUnless((ROOT / 'assets/game/files/MnSlChr.usd').exists(), 'Requires local verified game')
    def test_menu_relocation_pages_and_original_joint_indices(self):
        from opensmash_melee.skeleton import joints
        original = (ROOT / 'assets/game/files/MnSlChr.usd').read_bytes()
        digest = hashlib.sha256(original).hexdigest()
        raw = extend_menu(original, [(8, 1, self.source), (8, 2, self.source), (2, 0, self.source)], [318, 319, 320], {self.source: 1234})
        a, old = Archive(raw), Archive(original)
        record = a.roots()[SYMBOL]
        self.assertEqual(a.unpack('4I', record), (0x4F534353, 1, 3, 3))
        self.assertEqual([a.u32(record + 16 + i * 32 + 8) for i in range(3)], [1, 2, 1])
        self.assertEqual([a.u32(record + 16 + i * 32 + 28) for i in range(3)], [1234] * 3)
        for offset in (64, 112):
            for archive in (a, old):
                archive.public.append((archive.ptr(offset), len(archive.strings)))
                archive.strings += b'test_root\0'
            before, after = joints(old, 'test_root'), joints(a, 'test_root')
            self.assertEqual([j['offset'] for j in before], [j['offset'] for j in after[:-2]])
            self.assertEqual([j['position'][0] for j in after[-2:]], [-27, 27])
        self.assertEqual(hashlib.sha256(original).hexdigest(), digest)
        with self.assertRaisesRegex(ValueError, 'original menu'):
            extend_menu(raw, [], [])

    @unittest.skipUnless((ROOT / 'build/browser-engine/meleepad/ref/ModernGekko/include/moderngekko/mod_abi.h').exists(), 'Requires runtime headers')
    def test_actual_runtime_callbacks(self):
        import shutil
        import subprocess
        compiler = shutil.which('clang') or shutil.which('cc')
        if not compiler: self.skipTest('Requires a C compiler')
        executable = self.source / 'css-test'
        subprocess.run([compiler, '-std=c11', '-I', str(ROOT / 'build/browser-engine/meleepad/ref/ModernGekko/include'),
                        str(ROOT / 'tests/character_select_runtime.c'), '-lm', '-o', str(executable)], check=True, capture_output=True)
        subprocess.run([str(executable)], check=True, capture_output=True)

    def test_native_rejects_old_runtime_before_staging_rebased_audio(self):
        import threading
        from types import SimpleNamespace
        from unittest.mock import patch
        from opensmash_melee.native_service import NativeService
        service = NativeService.__new__(NativeService)
        service.lock = threading.Lock()
        service.manifest = {}
        service.cancelled = set()
        service.setup = SimpleNamespace(ready=True)
        service.process = None
        service.validate = lambda plan: ([], [(self.source, 'PlMrNr.dat')])
        with patch.dict('os.environ', {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'Update the desktop runtime'):
                service.launch({'session': '00000000-0000-0000-0000-000000000001'})

    def test_catalog_rejects_ambiguous_slots_and_wrong_movesets(self):
        catalog = {'test': {'slug': 'test', 'target': 'mario'}}
        entry = {'character': 'test', 'fighter': 8, 'color': 1, 'filename': 'PlMrYe.dat'}
        self.assertEqual(catalog_identities(self.source, catalog, [entry])[0][:2], (8, 1))
        for entries in ([entry, entry], [{**entry, 'fighter': 2}], [{**entry, 'color': True}], [{**entry, 'filename': '../x'}]):
            with self.assertRaises(ValueError): catalog_identities(self.source, catalog, entries)


if __name__ == '__main__': unittest.main()
