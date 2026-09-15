import unittest
from test_pipeline import fixture
from tools.pad_costume_slot import pad
from opensmash_melee.archive import Archive


class SlotTests(unittest.TestCase):
    def test_padding_preserves_offsets_symbols_and_body(self):
        raw=fixture().serialize();result=pad(raw,len(raw)+1024)
        self.assertEqual(result[4:len(raw)],raw[4:])
        self.assertEqual(Archive(result).roots(),Archive(raw).roots())
        self.assertEqual(result[len(raw):],bytes(1024))
        self.assertEqual(len(result),len(raw)+1024)

    def test_undersized_slot_rejected(self):
        raw=fixture().serialize()
        with self.assertRaises(ValueError):pad(raw,len(raw)-1)
