"""Validate a local native bundle's identity, signature and self-contained layout."""
import argparse
import json
from pathlib import Path
import subprocess
from build_native import digest, ISO_SHA256, DOL_SHA256


def verify(app):
    mac = app / 'Contents/MacOS'; resources = app / 'Contents/Resources'
    build = json.loads((resources / 'build.json').read_text())
    assert build['isoSha256'] == ISO_SHA256 and build['dolSha256'] == DOL_SHA256
    assert build['privateBuild'] is True
    assert digest(mac / 'game-module.dylib') == build['moduleSha256']
    assert (resources / 'Sys/GC').is_dir()
    assert not list(app.rglob('main.dol'))
    assert not [p for p in app.rglob('*') if p.suffix.lower() in ('.iso', '.gcm', '.rvz')]
    binaries = [mac / name for name in ('OpenSmashMelee','dolrecomp','game-module.dylib')]
    binaries.append(app / 'Contents/Helpers/Melee Engine.app/Contents/MacOS/MeleeRunner')
    binaries.append(resources / 'Mods/opensmash_launch.mgm.dylib')
    for binary in binaries:
        arch = subprocess.check_output(['lipo','-archs',str(binary)],text=True).strip()
        assert arch == 'arm64', (binary, arch)
        deps = subprocess.check_output(['otool','-L',str(binary)],text=True)
        assert '/opt/homebrew' not in deps and '/usr/local' not in deps, binary
    if build['costume']:
        assert digest(resources / build['costume']) == build['costumeSha256']
    schema = json.loads((resources / 'launch-options.json').read_text())
    assert [m['id'] for m in schema['modes']] == list(range(5))
    variants = [variant for character in build['characters'] for variant in [character] + character.get('targets', [])]
    for character in variants:
        slots = schema['costumes'][str(character['fighter'])]
        assert len(character['costumes']) == len(slots)
        for variants in [character['costumes'], character.get('compactCostumes') or []]:
            if not variants:continue
            assert len(variants)==len(slots)
            for costume, slot in zip(variants, slots):
                path = (resources / costume['path']).resolve()
                assert path.is_relative_to(resources.resolve())
                assert costume['filename'] == slot['filename']
                assert digest(path) == costume['sha256']
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    result = {'app':str(app),'moduleSha256':build['moduleSha256'],'character':build['character'],
              'romBundled':False,'architecture':'arm64','signature':'ad-hoc verified',
              'launchModes':len(schema['modes']),'customCharacters':len(build['characters']),'passes':True}
    return result


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app',type=Path); parser.add_argument('--output',type=Path)
    args=parser.parse_args(); result=json.dumps(verify(args.app.resolve()),indent=2)+'\n'
    if args.output: args.output.write_text(result)
    print(result,end='')
