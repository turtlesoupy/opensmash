"""Package an allowlisted, ROM-free native builder for sharing."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    'tools/specialize_native_math.py', 'tools/specialize_browser_math.py', 'tools/build_native.py', 'tools/build-native-macos.command',
    'tools/prepare_moderngekko.py', 'tools/verify_native_package.py',
    'tools/test_native_first_run.py', 'tools/test_native_launch_modes.py', 'tools/test_native_targets.py', 'tests/test_native_build.py', 'tests/test_native_target_options.py',
    'tools/package_native_sources.py',
    'runtime/upstream.json', 'runtime/mods/launch_match.c', 'runtime/mods/character_select.h', 'runtime/native/main.swift',
    'runtime/launch-options.json', 'runtime/native/LaunchOptions.swift',
    'runtime/patches/native/gameplay-qos.patch', 'runtime/patches/native/playback-activity.patch', 'runtime/native/skin_bridge.cpp', 'runtime/web/skin_runtime.cpp', 'runtime/patches/native/shared-skinning.patch',
    'runtime/native/Controllers.swift', 'runtime/native/Launcher.swift',
    'runtime/patches/meleepad/bootstrap.patch', 'runtime/patches/native/fixed-window.patch', 'runtime/patches/native/keyboard-events.patch',
    'opensmash_melee/__init__.py', 'opensmash_melee/archive.py',
    'opensmash_melee/costume_variant.py', 'opensmash_melee/materials.py', 'docs/NATIVE.md',
]
README = '''# OpenSmash Melee native builder

Apple Silicon macOS 14+ target. Install Xcode Command Line Tools, Python 3,
CMake and Ninja. In this extracted directory, run:

    python3 tools/build_native.py

The picker asks for your own unmodified Melee USA v1.02 ISO/GCM before any build
work. The full image hash is verified. Public dependencies are fetched at pinned
revisions, and native binaries are built locally. Open the resulting app in
build/native/. Its first run imports your ROM into its private support directory.
Press J to confirm Melee's first-run memory-card prompt if it appears.

This ZIP contains source scripts only: no ROM, extracted game assets, generated
game module, or custom costumes. The source-only build includes a native picker for all 26 Melee fighters and
five launch modes with stage, rules and four controller ports. Building and
converting OpenSmash custom characters uses the full project; --character-id can
package an existing native costume under build/characters/IDENTIFIER/.

See docs/NATIVE.md for commands, controls, smoke tests and current limitations.
Windows/Linux and native visual/performance parity have not been validated.
Share this source builder; each person builds the game-derived module locally.
'''


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'build/native/opensmash-melee-native-builder.zip')
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    manifest = {}
    with zipfile.ZipFile(args.output, 'x', zipfile.ZIP_DEFLATED) as archive:
        prefix = 'opensmash-melee-native-builder/'
        for name in FILES:
            content = (ROOT / name).read_bytes()
            entry = zipfile.ZipInfo(prefix + name)
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = (0o100755 if name.endswith('.command') else 0o100644) << 16
            archive.writestr(entry, content)
            manifest[name] = hashlib.sha256(content).hexdigest()
        archive.writestr(prefix + 'README.md', README)
        archive.writestr(prefix + 'source-hashes.json', json.dumps(manifest, indent=2) + '\n')
    print(args.output.resolve())
