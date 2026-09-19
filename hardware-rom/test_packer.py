"""Small corruption tests for the standalone ROM auditor."""
import unittest
import argparse
import json
import os
import sys
from pathlib import Path
import struct
import numpy as np
from build_rom import bind_to_local
from verify_rom import verify, TABLE, DATA, ENTRY

ROOT = Path(__file__).resolve().parent
BASE = ROOT.parents[1]/'BattleShip/baserom.us.z64'
ROM = Path(os.environ.get('SKIN_ROM', str(ROOT.parent/'build/rom/opensmash.z64')))


class BindTests(unittest.TestCase):
    def test_serialized_quarter_turn_preserves_forward(self):
        # OSB writer emits jm rows: a +90-degree Y turn maps local +Z
        # to world +X. Transposing again incorrectly returns local -Z.
        frame = np.array([10, 20, 30, 0, 0, 2, 0, 3, 0, -4, 0, 0], dtype=float)
        world = np.array([[12, 20, 30], [10, 23, 30], [10, 20, 26]])
        np.testing.assert_allclose(bind_to_local(frame, world),
                                   [[0, 0, 1], [0, 1, 0], [1, 0, 0]])


class AuditTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not BASE.is_file() or not ROM.is_file():
            raise unittest.SkipTest('Build the sample ROM or pass --base and --rom')
        cls.base = BASE.read_bytes()
        cls.rom = ROM.read_bytes()
        cls.loadout = json.loads(ROM.with_suffix('.json').read_text())['loadout']
        cls.fids = [f['model_file'] for f in cls.loadout]

    def test_complete_rom(self):
        self.assertEqual(verify(self.base, self.rom, self.fids, self.loadout),
                         {f['model_file']: f['triangles_after'] for f in self.loadout})

    def test_rejects_unexpected_code_change(self):
        bad = bytearray(self.rom)
        bad[0x1000] ^= 1
        with self.assertRaises(AssertionError):
            verify(self.base, bad, self.fids, self.loadout)

    def test_rejects_invalid_internal_pointer(self):
        bad = bytearray(self.rom)
        e = ENTRY.unpack_from(bad, TABLE+self.fids[0]*12)
        struct.pack_into('>H', bad, DATA+e[0]+e[1]*4+2, 65535)
        with self.assertRaises(AssertionError):
            verify(self.base, bad, self.fids, self.loadout)

    def test_rejects_broken_file_boundary(self):
        bad = bytearray(self.rom)
        struct.pack_into('>I', bad, TABLE+(self.fids[0]+1)*12, 0)
        with self.assertRaises(AssertionError):
            verify(self.base, bad, self.fids, self.loadout)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument('--base', type=Path, default=BASE)
    parser.add_argument('--rom', type=Path, default=ROM)
    args, remaining = parser.parse_known_args()
    BASE, ROM = args.base, args.rom
    unittest.main(argv=[sys.argv[0], *remaining])
