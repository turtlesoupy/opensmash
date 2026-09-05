"""Target isolation and subprocess-contract tests; no engine dependencies."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import build


class BuildTests(unittest.TestCase):
    def args(self, *args):
        return build.parser().parse_args(args)

    def test_native_does_not_require_rom_exporter_dependencies(self):
        result = subprocess.run([sys.executable, '-S', str(build.ROOT/'build.py'),
                                 'native', '--dry-run'], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('cmake --build', result.stdout)
        self.assertNotIn('build_rom.py', result.stdout)

    def test_output_directories_separate_targets_regions_and_configs(self):
        outputs = [build.plan(self.args(*argv))[0] for argv in [
            ('native',), ('native','--config','Debug'), ('native','--version','jp'), ('rom',)]]
        self.assertEqual(len(set(outputs)), 4)

    def test_paths_with_spaces_remain_single_arguments(self):
        _, _, commands = build.plan(self.args('native', '--battleship', '/tmp/engine checkout',
                                              '--rom', '/tmp/game files/base.z64'))
        self.assertIn(str(Path('/tmp/engine checkout').resolve()), commands[0])
        self.assertIn(f'-DSSB64_BASEROM={Path("/tmp/game files/base.z64").resolve()}', commands[0])

    def test_rom_verifies_models_from_selected_loadout(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp)/'roster.json'
            p.write_text(json.dumps([dict(model_file=323, asset='custom.osb',
                                          model_source='323_LuigiModel.c',main_source='221_LuigiMain.c')]))
            _, _, commands = build.plan(self.args('rom', '--loadout', str(p)))
            self.assertEqual(commands[-1][-2:], ['--models','323'])

    def test_native_preflight_does_not_create_output_when_inputs_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)/'output'
            with contextlib.redirect_stderr(io.StringIO()):
                rc = build.main(['native', '--battleship', str(Path(tmp)/'absent'), '--output-dir',str(out)])
            self.assertEqual(rc, 1)
            self.assertFalse(out.exists())

    def test_dry_run_creates_no_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)/'output'
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(build.main(['native','--dry-run','--output-dir',str(out)]), 0)
            self.assertFalse(out.exists())

    def test_native_discovers_alternative_rom_byte_order(self):
        with tempfile.TemporaryDirectory() as tmp:
            rom = Path(tmp)/'baserom.us.v64'
            rom.write_bytes(b'fixture')
            _, _, commands = build.plan(self.args('native','--battleship',tmp))
            self.assertIn(f'-DSSB64_BASEROM={rom.resolve()}', commands[0])

    def test_cmake_override_cannot_replace_driver_rom(self):
        for option in ['-DSSB64_BASEROM=bad', '-DSSB64_BASEROM:FILEPATH=bad', '-B/tmp/other']:
            with self.assertRaises(ValueError):
                build.plan(self.args('native','--cmake-arg='+option))

    def test_subprocess_failure_is_not_reported_complete(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)/'output'
            with patch.object(build, 'plan', return_value=(output, [], [['cmake','--version']])), \
                 patch.object(build.shutil,'which',return_value='/bin/cmake'), \
                 patch.object(build.subprocess,'run',side_effect=subprocess.CalledProcessError(2,'cmake')), \
                 contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(build.main(['native']),1)
            self.assertNotEqual(json.loads((output/'opensmash-target.json').read_text())['status'],'complete')


if __name__ == '__main__':
    unittest.main()
