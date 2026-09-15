import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
from tools import upgrade_character_surfaces as upgrade
from opensmash_melee import presentation, target_presentation

class CharacterSourceLookupTests(unittest.TestCase):
    def test_known_matching_artwork_does_not_scan_other_characters(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder); character=root/'assets/characters/example'
            output=root/'build/characters/example'; library=root/'library'
            character.mkdir(parents=True); output.mkdir(parents=True)
            source=library/'chosen';source.mkdir(parents=True)
            (character/'emblem_raw.png').write_bytes(b'artwork')
            (source/'emblem_raw.png').write_bytes(b'artwork')
            for name in ['character.json','stock_raw.png']:
                (character/name).write_bytes(b'fixture')
            (output/'profile.json').write_text(json.dumps({'stature':{'version':target_presentation.VERSION}}))
            original_glob=Path.glob
            def glob(path, pattern):
                self.assertNotEqual(path,library,'Scanned the entire library despite a verified source')
                return original_glob(path,pattern)
            with patch.object(upgrade,'ROOT',root), patch.dict('os.environ',{'OPENSMASH_CHARACTER_ROOT':str(library)}), patch.object(Path,'glob',glob), patch.object(presentation,'import_stencil',return_value=False):
                self.assertFalse(upgrade.upgrade_presentation('example',source))
