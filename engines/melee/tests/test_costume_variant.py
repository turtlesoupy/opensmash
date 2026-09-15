import unittest
from pathlib import Path
from opensmash_melee.archive import Archive
from opensmash_melee.costume_variant import SCHEMA, costume_variant

class CostumeVariants(unittest.TestCase):
    def test_rebinding_preserves_mesh_relocations_and_symbols(self):
        # Actual imported vanilla archives cover every supported costume layout.
        game=Path(__file__).resolve().parents[1]/'assets/game/files'
        if not game.exists(): self.skipTest('Requires locally imported game')
        for fighter,slots in SCHEMA['costumes'].items():
            raw=(game/slots[0]['filename']).read_bytes();original=Archive(raw)
            for color,slot in enumerate(slots):
                with self.subTest(fighter=fighter,color=color):
                    target=Archive(costume_variant(raw,int(fighter),color))
                    reference=Archive.read(game/slot['filename'])
                    self.assertIn(slot['symbol'],reference.roots())
                    self.assertIn(slot['symbol'],target.roots())
                    self.assertEqual(original.data,target.data)
                    self.assertEqual(original.relocs,target.relocs)
                    self.assertEqual(original.external,target.external)

if __name__=='__main__': unittest.main()
