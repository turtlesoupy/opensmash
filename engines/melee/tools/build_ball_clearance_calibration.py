"""Refresh packaged hand-clearance poses from the local original-rig probe."""
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    output = ROOT / 'runtime/retarget-clearance'
    output.mkdir(exist_ok=True)
    for slug, code in [('kirby', 'Kb'), ('jigglypuff', 'Pr')]:
        probe = ROOT / 'build/retarget-roster-probe' / slug / 'poses.json'
        samples = json.loads(probe.read_text())['clearancePoses']
        if not samples:
            raise ValueError(f'{slug}: regenerate the original animation probe first')
        costume = ROOT / 'assets/game/files' / f'Pl{code}Nr.dat'
        calibration = {'costume_sha256': hashlib.sha256(costume.read_bytes()).hexdigest(), 'samples': samples}
        (output / (slug + '.json.gz')).write_bytes(gzip.compress(json.dumps(calibration, separators=(',', ':')).encode(), mtime=0))
        print(slug, len(samples), 'sampled poses')

if __name__ == '__main__':
    main()
