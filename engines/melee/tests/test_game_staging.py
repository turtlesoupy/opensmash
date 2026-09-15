from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from opensmash_melee.game_staging import stage_game


class GameStagingTests(unittest.TestCase):
    def test_reuses_tree_restores_old_lineup_and_preserves_original_disc(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, game = root / 'source', root / 'lineup'
            (source / 'files').mkdir(parents=True)
            for name in ('first.dat', 'second.dat', 'menu.dat', 'unchanged.dat'):
                (source / 'files' / name).write_bytes(b'original')
            costume = root / 'costume.dat'
            costume.write_bytes(b'custom')
            def customize(stage):
                menu = stage / 'files/menu.dat'
                self.assertEqual(menu.read_bytes(), b'original')
                menu.unlink()
                menu.write_bytes(b'new menu')
                return ['menu.dat']
            stage_game(source, game, [(costume, 'first.dat')], customize)
            with patch('opensmash_melee.game_staging.shutil.copytree', side_effect=AssertionError('rebuilt tree')):
                stage_game(source, game, [(costume, 'second.dat')], customize)
                self.assertEqual((game / 'files/first.dat').read_bytes(), b'original')
                self.assertEqual((game / 'files/second.dat').read_bytes(), b'custom')
                stage_game(source, game, [], lambda _: [])
            for name in ('first.dat', 'second.dat', 'menu.dat', 'unchanged.dat'):
                self.assertEqual((source / 'files' / name).read_bytes(), b'original')
                self.assertEqual((game / 'files' / name).read_bytes(), b'original')

    def test_interrupted_update_and_changed_disc_force_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, game = root / 'source', root / 'lineup'
            (source / 'files').mkdir(parents=True)
            (source / 'files/base.dat').write_bytes(b'original')
            stage_game(source, game, [], lambda _: [])
            def fail(stage):
                (stage / 'files/base.dat').unlink()
                raise RuntimeError('interrupted')
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                stage_game(source, game, [], fail)
            self.assertFalse((game / '.opensmash-lineup.json').exists())
            stage_game(source, game, [], lambda _: [])
            self.assertEqual((game / 'files/base.dat').read_bytes(), b'original')
            (source / 'files/added.dat').write_bytes(b'new')
            stage_game(source, game, [], lambda _: [])
            self.assertEqual((game / 'files/added.dat').read_bytes(), b'new')
