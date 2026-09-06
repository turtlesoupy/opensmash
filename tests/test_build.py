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
            self.assertEqual(commands[-1][-3:], ['--loadout',str(p.resolve()),'--skinning'])

    def test_rom_skinning_default_and_rigid_override_reach_builder_and_audit(self):
        for flags,mode in [((), '--skinning'),(('--skinning',),'--skinning'),(('--no-skinning',),'--no-skinning')]:
            _,_,commands=build.plan(self.args('rom',*flags))
            for script in ('build_rom.py','verify_rom.py'):
                command=next(c for c in commands if any(a.endswith(script) for a in c))
                self.assertEqual(command[-1],mode)
                self.assertNotIn('--no-skinning' if mode=='--skinning' else '--skinning',command)

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

    def test_vanilla_has_no_roster_preparation(self):
        _, _, commands = build.plan(self.args('native', '--vanilla'))
        self.assertEqual(len(commands), 2)
        with self.assertRaises(ValueError):
            build.plan(self.args('native', '--vanilla', '--characters', 'queen'))

    def test_link_arguments_reach_both_targets_but_are_redacted(self):
        for target in ('native', 'rom'):
            _, _, commands = build.plan(self.args(target, '--characters', 'none',
                                                 '--character-url', 'https://example.test/#secret'))
            prepare = next(c for c in commands if any('targets/characters.py' in a for a in c))
            self.assertIn('https://example.test/#secret', prepare)
            self.assertNotIn('https://example.test/#secret', build.redacted(prepare))
            self.assertEqual(prepare[prepare.index('--characters')+1], 'none')

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

    def test_native_reuses_matching_configure(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp)
            commands = [['cmake','-S','engine'], ['cmake','--build',tmp]]
            (output/'CMakeCache.txt').write_text('fixture')
            (output/'opensmash-target.json').write_text(json.dumps(dict(
                target='native',status='complete',commands=commands)))
            with patch.object(build,'plan',return_value=(output,[],commands)), \
                 patch.object(build.shutil,'which',return_value='/bin/cmake'), \
                 patch.object(build.subprocess,'run') as run, \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(build.main(['native']),0)
                run.assert_called_once_with(commands[1],check=True,cwd=build.ROOT)


if __name__ == '__main__':
    unittest.main()
