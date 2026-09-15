# Third-party components

This app includes Electron/Chromium, Python, NumPy, SciPy, Pillow, the PyInstaller
bootloader, ModernGekko and its bundled dependencies. Their license notices remain
with their respective components. `runtime/` preserves notices from the pinned
ModernGekko source snapshot; Python package metadata is included in the frozen
service, and Electron supplies its own Chromium notices.

The runtime sources and local patches are identified by `runtime/upstream.json`
and the private native-inputs release. The launcher package metadata does not
grant a license to the original game, user-supplied discs, or generated characters.
