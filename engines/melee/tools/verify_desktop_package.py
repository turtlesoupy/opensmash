"""Smoke-test a distributable service from a clean profile without supplying a ROM."""

import argparse, json, os, queue, secrets, subprocess, sys, tempfile, threading, time, urllib.error, urllib.request
from pathlib import Path


def verify(resources):
    resources = resources.resolve()
    forbidden = []
    for path in resources.rglob("*"):
        if path.is_file() and (
            path.suffix.lower() in {".iso", ".gcm", ".rvz", ".dol", ".gci"}
            or path.name.startswith("Pl")
            and path.suffix.lower() == ".dat"
        ):
            forbidden.append(str(path.relative_to(resources)))
    if forbidden:
        raise ValueError("Game data found in package: " + ", ".join(forbidden[:10]))
    exe = (
        resources
        / "backend/melee-backend"
        / ("melee-backend.exe" if os.name == "nt" else "melee-backend")
    )
    runtime = resources / "runtime"
    # Exercise the bundled Pillow/WebP decoder, not the build machine's Python.
    portraits = subprocess.run(
        [str(exe), str(resources / "payload/tools/verify_desktop_portraits.py"),
         str(resources / "characters")],
        env={**os.environ, "OPENSMASH_WORKSPACE": str(resources / "payload")},
        check=True, capture_output=True, text=True, timeout=60,
    )
    portrait_report = json.loads(portraits.stdout)
    manifest = json.loads((runtime / "runtime.json").read_text())
    suffix = (
        ".dll" if os.name == "nt" else ".dylib" if sys.platform == "darwin" else ".so"
    )
    plugin = runtime / "Mods" / ("opensmash_launch.mgm" + suffix)
    if not plugin.is_file():
        raise ValueError("Launch plugin has the wrong platform filename")
    # Loading the tools catches missing shared libraries before asking for an ISO.
    subprocess.run(
        [str(runtime / manifest["runner"]), "--help"],
        check=True,
        capture_output=True,
        timeout=20,
    )
    subprocess.run(
        [str(runtime / manifest["controllers"])],
        check=True,
        capture_output=True,
        timeout=20,
    )
    token = secrets.token_hex(32)
    with tempfile.TemporaryDirectory(prefix="opensmash-package-") as folder:
        with (Path(folder) / "service.log").open("w+") as log:
            process = subprocess.Popen(
                [str(exe), "--desktop", folder, "--resources", str(resources)],
                stdout=subprocess.PIPE,
                stderr=log,
                text=True,
                env={**os.environ, "OPENSMASH_DESKTOP_TOKEN": token},
            )
            lines = queue.Queue()

            def read():
                for line in process.stdout:
                    lines.put(line)

            threading.Thread(target=read, daemon=True).start()
            try:
                deadline = time.monotonic() + 45
                port = None
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        log.seek(0)
                        raise RuntimeError(log.read())
                    try:
                        line = lines.get(timeout=1)
                    except queue.Empty:
                        continue
                    try:
                        port = json.loads(line).get("port")
                    except (ValueError, AttributeError):
                        continue
                    if port:
                        break
                if not port:
                    raise RuntimeError("Frozen service did not announce a port")
                origin = "http://127.0.0.1:" + str(port)

                def request(route, body=None, authenticated=True):
                    headers = {"Content-Type": "application/json"}
                    if authenticated:
                        headers["X-OpenSmash-Token"] = token
                    req = urllib.request.Request(
                        origin + route,
                        data=None if body is None else json.dumps(body).encode(),
                        headers=headers,
                    )
                    with urllib.request.urlopen(req, timeout=10) as response:
                        return json.load(response)

                status = request("/api/setup")
                if status["ready"]:
                    raise AssertionError("Fresh package bypassed ISO requirement")
                try:
                    request("/api/setup", authenticated=False)
                except urllib.error.HTTPError as error:
                    if error.code != 403:
                        raise
                else:
                    raise AssertionError("Unauthenticated service access was allowed")
                catalog = request("/catalog.json")
                if not catalog:
                    raise AssertionError("Missing packaged character catalog")
                wrong = Path(folder) / "wrong.iso"
                wrong.write_bytes(b"not a game")
                request("/api/native/disc", {"path": str(wrong)})
                for _ in range(100):
                    status = request("/api/setup")
                    if status["state"] == "error":
                        break
                    time.sleep(0.05)
                if status["ready"] or status["state"] != "error":
                    raise AssertionError("Invalid disc was not rejected")
                return {
                    "protocol": 1,
                    "characters": len(catalog),
                    "portraitAssets": portrait_report,
                    "isoRequired": True,
                    "invalidDiscRejected": True,
                    "sessionAuthentication": True,
                    "noBundledDisc": True,
                }
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("resources", type=Path)
    args = parser.parse_args()
    print(json.dumps(verify(args.resources), indent=2))
