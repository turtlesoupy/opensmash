"""Build a versioned native payload independently of the Electron launcher."""

import argparse, hashlib, json, os, platform, plistlib, shutil, subprocess, sys, tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args):
    subprocess.run(list(map(str, args)), check=True)


def build(inputs, out):
    source = ROOT / "build/desktop-runtime-source"
    # Extraction over a previous patched tree leaves added files behind, making
    # the next patch application inconsistent. Keep compiled caches separately.
    if source.exists():
        shutil.rmtree(source)
    source.mkdir(parents=True, exist_ok=True)
    with tarfile.open(inputs) as archive:
        archive.extractall(source, filter="data")
    manifest = json.loads((source / "inputs.json").read_text())
    for name, digest in manifest["sha256"].items():
        path = (source / name).resolve()
        if (
            not path.is_relative_to(source.resolve())
            or hashlib.sha256(path.read_bytes()).hexdigest() != digest
        ):
            raise ValueError("Build input integrity failure: " + name)
    runtime = source / "runtime"
    from build_native import apply_native_patches
    # Immutable desktop inputs already contain the earlier native patches plus
    # platform fixes. Reversing that history would undo those platform fixes.
    apply_native_patches(runtime, [ROOT / "runtime/patches/native" / name for name in [
        "keyboard-no-beep.patch", "zz-electron-embedded.patch", "windows-sdk-compat.patch",
        "zz-graceful-stop.patch",
        "zz-performance.patch", "zz-windows-jit.patch", "zz-startup.patch", "zzz-jit-memory.patch", "zz-startup-cancel.patch",
        "zzzz-mod-boundaries.patch", "zz-embedded-background-input.patch", "zzzzz-launcher-input.patch"
    ]])
    host = ROOT / "build/desktop-runtime-host"
    module = ROOT / "build/desktop-runtime-module"
    # Apple SDKs before Xcode 26 lack std::jthread. Keep identical cooperative
    # shutdown with C++11 thread/atomic primitives on every supported compiler.
    runner_source = runtime / "tools/moderngekko_run.cpp"
    text = runner_source.read_text()
    text = text.replace("#include <thread>", "#include <thread>\n#include <atomic>")
    text = text.replace(
        "std::jthread signal_watcher([&](std::stop_token stop_token) {",
        "std::atomic<bool> stop_watcher{false};\n  std::thread signal_watcher([&]() {",
    )
    text = text.replace("!stop_token.stop_requested()", "!stop_watcher.load()")
    text = text.replace(
        "signal_watcher.request_stop();",
        "stop_watcher.store(true);\n  signal_watcher.join();",
    )
    runner_source.write_text(text)
    if sys.platform.startswith("linux"):
        cmake = runtime / "CMakeLists.txt"
        cmake.write_text(
            cmake.read_text().replace(
                'set(ENABLE_CUBEB OFF CACHE BOOL "" FORCE)',
                'set(ENABLE_CUBEB ON CACHE BOOL "" FORCE)',
            )
        )
    if os.name == "nt":
        bbox = runtime / "vendor/dolphin/Source/Core/VideoBackends/D3D/D3DBoundingBox.cpp"
        bbox.write_text(bbox.read_text().replace("D3D11_BOX box{index * sizeof(BBoxType),", "D3D11_BOX box{static_cast<u32>(index * sizeof(BBoxType)),"))
        fzero = runtime / "vendor/dolphin/Source/Core/Core/HW/Triforce/FZeroAX.cpp"
        fzero.write_text("#include <functional>\n" + fzero.read_text())
        timing = runtime / "vendor/dolphin/Source/Core/VideoCommon/LightweightFrameTimingRecorder.cpp"
        timing_text = timing.read_text().replace('#include <ctime>', '#include <ctime>\n#define WIN32_LEAN_AND_MEAN\n#define NOMINMAX\n#include <windows.h>')
        start = timing_text.index('  timespec time{};')
        end = timing_text.index('\n}', start)
        timing_text = timing_text[:start] + """  FILETIME created{}, exited{}, kernel{}, user{};
  if (!GetThreadTimes(GetCurrentThread(), &created, &exited, &kernel, &user))
    return 0;
  const auto ticks = [](FILETIME t) {
    return (static_cast<std::uint64_t>(t.dwHighDateTime) << 32) | t.dwLowDateTime;
  };
  return (ticks(kernel) + ticks(user)) * 100ULL;""" + timing_text[end:]
        timing.write_text(timing_text)
        core_clock = runtime / "vendor/dolphin/Source/Core/Core/PowerPC/StaticRecomp/StaticRecompCore_Run.cpp"
        core_text = core_clock.read_text().replace('#include <ctime>', '#include <ctime>\n#define WIN32_LEAN_AND_MEAN\n#define NOMINMAX\n#include <windows.h>')
        start = core_text.index('  timespec time{};')
        end = core_text.index('\n}', start)
        core_text = core_text[:start] + """  FILETIME created{}, exited{}, kernel{}, user{};
  if (!GetThreadTimes(GetCurrentThread(), &created, &exited, &kernel, &user)) return 0;
  const auto ticks = [](FILETIME t) {
    return (static_cast<u64>(t.dwHighDateTime) << 32) | t.dwLowDateTime;
  };
  return (ticks(kernel) + ticks(user)) * 100ULL;""" + core_text[end:]
        core_clock.write_text(core_text)
        # clang-cl supports target attributes but does not define __GNUC__.
        cull = runtime / "vendor/dolphin/Source/Core/VideoCommon/CPUCullImpl.h"
        cull.write_text(cull.read_text().replace("defined(__GNUC__)", "(defined(__GNUC__) || defined(__clang__))"))
        # clang-cl uses the MSVC frontend, even though its compiler ID is Clang.
        implot = runtime / "vendor/dolphin/Externals/implot/CMakeLists.txt"
        implot.write_text(implot.read_text().replace("CXX_COMPILER_ID:MSVC", "BOOL:${MSVC}"))
        pch = runtime / "vendor/dolphin/Source/PCH/CMakeLists.txt"
        pch.write_text(pch.read_text().replace("#return()", "return()"))
        vendor_cmake = runtime / "vendor/dolphin/CMakeLists.txt"
        vendor_cmake.write_text(
            vendor_cmake.read_text().replace(
                "add_compile_options(/WX)",
                "# Keep upstream warnings visible without promoting new clang-cl diagnostics to errors.",
            )
        )
        for name in ["AES.cpp", "SHA1.cpp"]:
            source_file = runtime / "vendor/dolphin/Source/Core/Common/Crypto" / name
            source_file.write_text(
                source_file.read_text().replace(
                    "#ifdef _MSC_VER\n#define ATTRIBUTE_TARGET(x)",
                    "#if defined(_MSC_VER) && !defined(__clang__)\n#define ATTRIBUTE_TARGET(x)",
                )
            )
    # clang-cl's Microsoft empty-variadic extension can swallow the separator
    # before the assertion condition. Put mandatory arguments first instead.
    assertions = runtime / "vendor/dolphin/Source/Core/Common/Assert.h"
    assertion_text = assertions.read_text()
    assertion_text = (
        assertion_text.replace(
            '"An error occurred.\\n\\n" _fmt_ "\\n\\n"',
            '"An error occurred.\\n\\n"',
        )
        .replace(
            '"Ignore and continue?",',
            '_fmt_ "\\n\\nIgnore and continue?",',
            1,
        )
        .replace(
            "__VA_ARGS__ __VA_OPT__(, ) #_a_, __FILE__, __LINE__, __func__",
            "#_a_, __FILE__, __LINE__, __func__ __VA_OPT__(, ) __VA_ARGS__",
        )
    )
    assertions.write_text(assertion_text)
    flags = [
        "-DCMAKE_BUILD_TYPE=Release",
        "-DUSE_SYSTEM_LIBS=OFF",
        "-DENABLE_QT=OFF",
        "-DENABLE_TESTS=OFF",
        "-DUSE_DISCORD_PRESENCE=OFF",
        "-DUSE_MGBA=OFF",
        "-DUSE_RETRO_ACHIEVEMENTS=OFF",
        "-DENABLE_AUTOUPDATE=OFF",
        "-DENABLE_ANALYTICS=OFF",
        "-DUSE_UPNP=OFF",
        "-DMODERNGEKKO_GAMECUBE_CONTROLLERS=ON",
        "-DMODERNGEKKO_APP_BUNDLE=OFF",
        "-DOPENSMASH_NATIVE_SOURCE=" + str(ROOT / "runtime"),
        "-DOPENSMASH_DESKTOP_SOURCE=" + str(ROOT / "desktop"),
    ]
    if os.name == "nt":
        # SDK header mtimes differ on ephemeral builders; cached PCHs are not portable.
        flags.append("-DCMAKE_DISABLE_PRECOMPILE_HEADERS=ON")
    if shutil.which("ccache"):
        flags += [
            "-DCMAKE_C_COMPILER_LAUNCHER=ccache",
            "-DCMAKE_CXX_COMPILER_LAUNCHER=ccache",
        ]
    if os.name == "nt":
        flags += ["-DCMAKE_CXX_FLAGS=-Wno-microsoft-include " + os.environ.get("CXXFLAGS", "")]
    if sys.platform == "darwin":
        flags += [
            "-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0",
            "-DENABLE_VULKAN=OFF",
            "-DMODERNGEKKO_APP_BUNDLE=ON",
        ]
    run("cmake", "-S", runtime, "-B", host, "-G", "Ninja", *flags)
    jobs = str(min(os.cpu_count() or 2, 48))
    run(
        "cmake",
        "--build",
        host,
        "--target",
        "moderngekko-run",
        "dolrecomp",
        "opensmash-launch",
        "opensmash-controllers",
        "opensmash-embedded-test",
        "opensmash-mod-dispatch-test",
        "opensmash-hash-test",
        "opensmash-backend-test",
        "-j",
        jobs,
    )
    run(host / ("opensmash-backend-test.exe" if os.name == "nt" else "opensmash-backend-test"))
    input_test = host / ("opensmash-embedded-test.exe" if os.name == "nt" else "opensmash-embedded-test")
    run(input_test, host / "embedded-input-test.bin")
    run(host / ("opensmash-mod-dispatch-test.exe" if os.name == "nt" else "opensmash-mod-dispatch-test"))
    run(host / ("opensmash-hash-test.exe" if os.name == "nt" else "opensmash-hash-test"), host / "hash-test-data.bin")
    run(
        "cmake",
        "-S",
        runtime / "vendor/dolphin/module-template",
        "-B",
        module,
        "-G",
        "Ninja",
        "-DCMAKE_BUILD_TYPE=Release",
        "-DGAME_ID=GALE01",
        "-DGENERATED_DIR=" + str(source / "generated"),
        "-DRECOMPCORE_MODULE_ENABLE_IPO=OFF",
        *(["-DCMAKE_C_COMPILER_LAUNCHER=ccache"] if shutil.which("ccache") else []),
        *(["-DCMAKE_OSX_DEPLOYMENT_TARGET=14.0"] if sys.platform == "darwin" else [])
    )
    run("cmake", "--build", module, "-j", jobs)
    out.mkdir(parents=True, exist_ok=True)
    (out / "Mods").mkdir(exist_ok=True)
    exe = ".exe" if os.name == "nt" else ""
    lib = ".dll" if os.name == "nt" else ".dylib" if sys.platform == "darwin" else ".so"
    paths = {
        "runner": "moderngekko-run" + exe,
        "module": "gGALE01_recomp" + lib,
        "controllers": "opensmash-controllers" + exe,
    }
    for name in [paths["runner"], paths["controllers"]]:
        shutil.copy2(host / name, out / name)
    shutil.copy2(module / paths["module"], out / paths["module"])
    dol = next(p for p in host.rglob("dolrecomp" + exe) if p.is_file())
    shutil.copy2(dol, out / ("dolrecomp" + exe))
    mod = next(
        p
        for p in host.glob("opensmash_launch.mgm.*")
        if p.suffix in {".dll", ".so", ".dylib"}
    )
    mod_name = "opensmash_launch.mgm" + lib
    shutil.copy2(mod, out / "Mods" / mod_name)
    shutil.copytree(host / "Sys", out / "Sys", dirs_exist_ok=True)
    if os.name == "nt":
        # Users need no Visual Studio installation. Bundle the redistributable CRT
        # supplied by the runner's activated Microsoft toolchain.
        redist = os.environ.get("VCToolsRedistDir")
        if not redist:
            raise RuntimeError(
                "Activate the MSVC developer environment before packaging Windows"
            )
        candidates = list(Path(redist).glob("x64/Microsoft.VC*.CRT"))
        if not candidates:
            raise RuntimeError("MSVC x64 runtime redistributables are missing")
        for library in sorted(candidates)[-1].glob("*.dll"):
            shutil.copy2(library, out / library.name)
        for p in host.rglob("*.dll"):
            shutil.copy2(p, out / p.name)
    if sys.platform == "darwin":
        app = out / "Melee Engine.app"
        mac = app / "Contents/MacOS"
        mac.mkdir(parents=True, exist_ok=True)
        shutil.move(out / paths["runner"], mac / "MeleeRunner")
        shutil.copytree(out / "Sys", app / "Contents/Resources/Sys", dirs_exist_ok=True)
        paths["runner"] = "Melee Engine.app/Contents/MacOS/MeleeRunner"
        (app / "Contents/Info.plist").write_bytes(
            plistlib.dumps(
                {
                    "CFBundleExecutable": "MeleeRunner",
                    "CFBundleIdentifier": "fun.smash.melee.engine",
                    "CFBundleName": "Melee Engine",
                    "CFBundlePackageType": "APPL",
                    "CFBundleVersion": "1",
                    "LSMinimumSystemVersion": "14.0",
                    "NSHighResolutionCapable": True,
                }
            )
        )
        for p in [
            out / paths["runner"],
            out / paths["module"],
            out / paths["controllers"],
            out / ("dolrecomp" + exe),
            out / "Mods" / mod_name,
        ]:
            run("codesign", "--force", "--sign", "-", p)
        run("codesign", "--force", "--sign", "-", app)
    hashes = {
        p.relative_to(out).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in out.rglob("*")
        if p.is_file() and p.name != "runtime.json"
    }
    (out / "runtime.json").write_text(
        json.dumps(
            {
                "protocol": 1,
                "gracefulShutdown": "file-v1",
                "characterSelect": 1,
                "keyboardKeys": 2,
                "launcherInput": 1,
                "platform": sys.platform,
                "architecture": platform.machine(),
                "embeddedSurfaces": ["rgba-memory-v1"] + (["iosurface-v1"] if sys.platform == "darwin" else []),
                "sha256": hashes,
                **paths,
            },
            indent=2,
        )
        + "\n"
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("inputs", type=Path)
    p.add_argument("--output", type=Path, default=ROOT / "build/desktop-runtime")
    a = p.parse_args()
    build(a.inputs, a.output)
