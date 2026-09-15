"""Exercise packaged ROM rejection, fresh import, and native combat without windows."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile
from build_native import ISO_BYTES
from verify_native_package import verify


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--rom', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    app = args.app.resolve()
    result = {'package': verify(app)}
    executable = app / 'Contents/MacOS/OpenSmashMelee'
    with tempfile.TemporaryDirectory(prefix='opensmash-rom-rejection-') as temporary:
        wrong = Path(temporary) / 'wrong image with spaces.gcm'
        with wrong.open('wb') as stream:
            stream.truncate(ISO_BYTES)
        rejected = subprocess.run([str(executable), '--verify-rom', str(wrong)], capture_output=True, text=True, timeout=20)
        assert rejected.returncode != 0 and 'does not match' in rejected.stderr, rejected
        result['wrongSameSizeRomRejected'] = True
    user = args.output / 'fresh-user'
    if user.exists():
        raise ValueError('Choose a fresh --output directory to test first-run import.')
    run = subprocess.run([str(executable), '--smoke-test', str(args.rom.resolve()), '--user-dir', str(user.resolve())],
                         capture_output=True, text=True, timeout=80)
    (args.output / 'smoke.log').write_text(run.stdout + run.stderr)
    result.update(exitCode=run.returncode, headlessCombat180Frames=run.returncode == 0 and 'PASS:' in run.stdout)
    result['passes'] = result['headlessCombat180Frames']
    (args.output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    if not result['passes']:
        raise SystemExit('Native first-run test failed. See smoke.log and fresh-user/game.log.')


if __name__ == '__main__':
    main()
