"""Failures retain evidence and retries can rebuild under the same identity."""
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from opensmash_melee.character_build import archive_previous_build, run_stage
from opensmash_melee.character_import import download

class CharacterBuildTests(unittest.TestCase):
    def test_retry_archives_output_and_remaps_its_own_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);source=root/'assets/characters/fixture'
            source.mkdir(parents=True);(source/'rigged.glb').write_bytes(b'original')
            output=root/'build/characters/fixture';output.mkdir(parents=True)
            (output/'shape.json').write_text('failed shape')
            moved=archive_previous_build(root,'fixture',source)
            self.assertFalse(source.exists());self.assertFalse(output.exists())
            self.assertEqual((moved/'rigged.glb').read_bytes(),b'original')
            self.assertEqual((moved.parent/'output/shape.json').read_text(),'failed shape')
            source.mkdir();output.mkdir()
            self.assertNotEqual(archive_previous_build(root,'fixture',source),moved)
            self.assertEqual((moved/'rigged.glb').read_bytes(),b'original')

    def test_failed_stage_reports_moveset_and_retains_unicode_stderr(self):
        with tempfile.TemporaryDirectory() as directory:
            log=Path(directory)/'import.log'
            with patch('subprocess.run',return_value=SimpleNamespace(returncode=2,stdout='Guaxinim dos Milhões\n',stderr='Source-shape check needs manual review')) as run:
                with self.assertRaisesRegex(ValueError,'Fitting character for Fox failed.*Diagnostic log'):
                    run_stage(['tools/build_character.py'],Path(directory),log,'Fitting character','fox')
                self.assertEqual(run.call_args.kwargs['encoding'],'utf-8')
                self.assertEqual(run.call_args.kwargs['env']['PYTHONIOENCODING'],'utf-8')
            self.assertIn('Milhões',log.read_text());self.assertIn('Source-shape check',log.read_text())

    def test_timeout_keeps_partial_output_and_identifies_stage(self):
        with tempfile.TemporaryDirectory() as directory:
            log=Path(directory)/'import.log'
            with patch('subprocess.run',side_effect=subprocess.TimeoutExpired('build',240,output=b'progress',stderr=b'last error')):
                with self.assertRaisesRegex(ValueError,'Building playable costume for Pikachu timed out'):
                    run_stage([],directory,log,'Building playable costume','pikachu')
            self.assertIn('last error',log.read_text());self.assertIn('progress',log.read_text())

    def test_expired_link_is_distinct_from_network_failure(self):
        for error,message in [(HTTPError('https://smash.fun',404,'missing',{},None),'no longer available'),(URLError('offline'),'connection'),(HTTPError('https://smash.fun',503,'busy',{},None),'HTTP 503')]:
            with patch('opensmash_melee.character_import.build_opener') as opener:
                opener.return_value.open.side_effect=error
                with self.assertRaisesRegex(ValueError,message):download('https://smash.fun/manifest.json',1024)
