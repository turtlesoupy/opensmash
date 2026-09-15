"""Prepare private native build inputs. Never includes a disc or extracted game assets."""

import argparse, hashlib, json, subprocess, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def package(output):
    runtime = ROOT / "build/browser-engine/meleepad/ref/ModernGekko"
    required = [
        "vendor/dolphin/Externals/VulkanMemoryAllocator/include/vk_mem_alloc.h",
        "vendor/dolphin/Externals/Vulkan-Headers/include/vulkan/vulkan.h",
        "vendor/dolphin/Externals/cpp-ipc/cpp-ipc/CMakeLists.txt",
        "vendor/dolphin/Externals/wil/include/wil/resource.h",
        "vendor/dolphin/Externals/glslang/glslang/build_info.h.tmpl",
    ]
    for name in required:
        if not (runtime/name).is_file():raise ValueError("Initialize the pinned platform dependency first: "+name)
    pointer = (
        ROOT
        / "build/browser-engine/meleepad/ref/ModernGekko-Template/build/modules-macos14-r2/GALE01/active-module.txt"
    )
    module = Path(pointer.read_text().strip())
    if not module.is_absolute():
        module = pointer.parents[3] / module
    generated = module.parent / "dolrecomp-output/generated"
    assert (generated / "generated.h").is_file()
    assert (module.parent / "module-build/module_tables.inc").is_file()
    output.parent.mkdir(parents=True, exist_ok=True)
    hashes = {}
    with tarfile.open(output, "w:gz") as archive:

        def add(path, name, data=None):
            raw = path.read_bytes() if data is None else data
            import io

            entry = tarfile.TarInfo(name)
            entry.size = len(raw)
            entry.mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
            archive.addfile(entry, io.BytesIO(raw))
            hashes[name] = hashlib.sha256(raw).hexdigest()

        for path in runtime.rglob("*"):
            rel = path.relative_to(runtime)
            if (
                not path.is_file()
                or path.is_symlink()
                or (
                    rel.parts[0].startswith("build")
                    or any(
                        p
                        in [
                            ".git",
                            ".cache",
                            "node_modules",
                            "__pycache__",
                            "CMakeFiles",
                        ]
                        for p in rel.parts
                    )
                )
            ):
                continue
            if path.suffix.lower() in [
                ".iso",
                ".gcm",
                ".rvz",
                ".dol",
                ".dat",
                ".o",
                ".a",
                ".so",
                ".dylib",
                ".exe",
                ".dll",
                ".pyc",
            ]:
                continue
            raw = None
            if rel.as_posix() == "CMakeLists.txt":
                raw = (
                    path.read_text()
                    + '\ninclude("${OPENSMASH_DESKTOP_SOURCE}/runtime.cmake")\n'
                ).encode()
            if rel.as_posix() == "vendor/dolphin/module-template/CMakeLists.txt":
                text = path.read_text()
                a = text.index("foreach(REQUIRED_GENERATED_FILE")
                b = text.index("set(GXRUNTIME_DIR", a)
                text = text[:a] + text[b:]
                a = text.index("set(MODULE_TABLES")
                b = text.index("file(READ", a)
                text = (
                    text[:a]
                    + 'set(MODULE_TABLES "${GENERATED_DIR}/module_tables.inc")\n'
                    + text[b:]
                )
                raw = text.encode()
            add(path, "runtime/" + rel.as_posix(), raw)
        for path in generated.rglob("*"):
            if path.is_file() and path.suffix in [".c", ".h", ".txt"]:
                add(path, "generated/" + path.relative_to(generated).as_posix())
        add(
            module.parent / "module-build/module_tables.inc",
            "generated/module_tables.inc",
        )
        import io

        raw = json.dumps(
            {
                "format": 1,
                "private": True,
                "containsGameDerivedCode": True,
                "containsDiscOrExtractedAssets": False,
                "sha256": hashes,
            },
            indent=2,
        ).encode()
        entry = tarfile.TarInfo("inputs.json")
        entry.size = len(raw)
        archive.addfile(entry, io.BytesIO(raw))
    print(output, output.stat().st_size)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument(
        "--output",
        type=Path,
        default=ROOT / "build/desktop-inputs/native-inputs.tar.gz",
    )
    package(p.parse_args().output)
