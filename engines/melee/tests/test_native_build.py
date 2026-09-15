import hashlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import build_native


class NativeROMTests(unittest.TestCase):
    def test_wrong_size_is_rejected_before_hashing(self):
        with tempfile.TemporaryDirectory() as folder:
            rom = Path(folder) / 'wrong.iso'
            rom.write_bytes(b'not a game')
            with patch.object(build_native, 'digest') as digest:
                with self.assertRaisesRegex(ValueError, 'unmodified USA'):
                    build_native.verify_rom(rom)
                digest.assert_not_called()

    def test_full_contents_required_even_when_size_matches(self):
        with tempfile.TemporaryDirectory() as folder:
            rom = Path(folder) / 'game with spaces.gcm'
            rom.write_bytes(b'known')
            with patch.object(build_native, 'ISO_BYTES', 5), patch.object(
                    build_native, 'ISO_SHA256', hashlib.sha256(b'known').hexdigest()):
                self.assertEqual(build_native.verify_rom(rom), rom.resolve())
                rom.write_bytes(b'wrong')
                with self.assertRaisesRegex(ValueError, 'hash does not match'):
                    build_native.verify_rom(rom)

    def test_picker_cancellation_does_not_start_a_build(self):
        with patch.object(build_native.platform, 'system', return_value='Darwin'), patch.object(
                build_native.subprocess, 'run') as run:
            run.return_value.returncode = 1
            with self.assertRaisesRegex(ValueError, 'cancelled'):
                build_native.prompt_rom()
            self.assertEqual(run.call_count, 1)



class NativePatchTests(unittest.TestCase):
    def test_overlapping_series_handles_fresh_partial_and_current_checkouts(self):
        import difflib
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);patches=root/'runtime/patches/native';patches.mkdir(parents=True)
            original='first\ncontext\nlast\n';one='first\nfeature one\ncontext\nlast\n';two=one.replace('feature one','feature two')
            for name,a,b in [('01.patch',original,one),('02.patch',one,two)]:
                (patches/name).write_text(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/file.txt',tofile='b/file.txt')))
            for initial in [original,one,two]:
                checkout=root/'checkout';checkout.mkdir(exist_ok=True);target=checkout/'file.txt';target.write_text(initial)
                unrelated=checkout/'user.txt';unrelated.write_text('keep this')
                with patch.object(build_native,'ROOT',root):
                    build_native.apply_native_patches(checkout)
                    self.assertEqual(target.read_text(),two)
                    before=target.stat().st_mtime_ns
                    build_native.apply_native_patches(checkout)
                    self.assertEqual(target.stat().st_mtime_ns,before)
                self.assertEqual(unrelated.read_text(),'keep this')

if __name__ == '__main__':
    unittest.main()
