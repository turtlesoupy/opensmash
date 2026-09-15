"""Check actual JS slot padding against the independent HSD archive parser."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from opensmash_melee.archive import Archive

paths = sorted((ROOT / 'build/characters').glob('web-v1-*/browser/Pl*Nr.dat'))
paths += [ROOT / 'assets/game/files' / name for name in
          ('PlMrNr.dat', 'PlLgNr.dat', 'PlCaNr.dat', 'PlFxNr.dat', 'PlMsNr.dat', 'PlLkNr.dat')]
results = []
with tempfile.TemporaryDirectory() as temporary:
    output = Path(temporary) / 'slot.dat'
    script = """
      import {readFileSync,writeFileSync} from 'node:fs';
      import {costumeSlot} from './runtime/web/local-files.mjs';
      writeFileSync(process.argv[2],costumeSlot(readFileSync(process.argv[1])));
    """
    for path in paths:
        subprocess.run(['node', '--input-type=module', '-e', script, str(path), str(output)], cwd=ROOT, check=True)
        before, after = Archive.read(path), Archive.read(output)
        assert before.data == after.data
        assert before.relocs == after.relocs
        assert before.public == after.public and before.external == after.external
        assert before.roots() == after.roots()
        assert all(before.symbol(name) == after.symbol(name) for _, name in before.external)
        results.append({'file': str(path.relative_to(ROOT)), 'bytes': path.stat().st_size,
                        'slotBytes': output.stat().st_size, 'relocations': len(before.relocs), 'passes': True})
target = ROOT / 'build/moderngekko-validation/browser-slot-integrity.json'
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(results, indent=2) + '\n')
print(f'Archive contents, relocations and symbols preserved for {len(results)} costumes.')
