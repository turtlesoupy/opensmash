"""Stage a tagged checkout; supervise temporary builders with enforced lifetimes."""

import argparse
import json
import re
import subprocess
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONFIG = json.loads((ROOT / "infra/gcp/release.json").read_text())


def command(*args, capture=False):
    return subprocess.run(
        list(map(str, args)),
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
    )


def cloud(*args, capture=False):
    return command(
        "gcloud", *args, "--project=" + CONFIG["project"], "--quiet", capture=capture
    )


def validate_release(tag, commit, version):
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", tag):
        raise ValueError("Only version release tags can build packages")
    if tag[1:] != version:
        raise ValueError("Tag must match desktop/package.json version")
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("An exact source commit is required")


def stage(args):
    validate_release(
        args.tag,
        args.commit,
        json.loads((ROOT / "desktop/package.json").read_text())["version"],
    )
    if not cloud_enabled():
        print("Local release selected; skipping cloud source staging.", flush=True)
        return
    source = Path("/tmp/opensmash-release-source.tar.gz")

    def include(info):
        parts = Path(info.name).parts
        if any(p in {".git", "node_modules", "__pycache__"} for p in parts):
            return None
        if parts and parts[0] in {"build", "assets", ".venv"}:
            return None
        if info.name.startswith("web/dist") or info.name.startswith("desktop/dist"):
            return None
        return info

    with tarfile.open(source, "w:gz") as archive:
        for p in ROOT.iterdir():
            archive.add(p, arcname=p.name, filter=include)
    prefix = f"gs://{CONFIG['bucket']}/jobs/{args.build}"
    request = Path("/tmp/release-request.json")
    request.write_text(
        json.dumps({"tag": args.tag, "commit": args.commit, "build": args.build})
    )
    cloud("storage", "cp", source, prefix + "/source.tar.gz")
    cloud("storage", "cp", request, prefix + "/request.json")
    print(
        f"Release {args.tag}, commit {args.commit}. macOS packages require an Apple builder.",
        flush=True,
    )


def cloud_enabled():
    mode = CONFIG.get("buildMode", "cloud")
    if mode not in {"local", "cloud"}:
        raise ValueError("buildMode must be local or cloud")
    return mode == "cloud"


def run(args):
    if not getattr(args, "smoke", False) and not cloud_enabled():
        print("Local release selected; skipping cloud builder.", flush=True)
        return
    if not re.fullmatch(r"[a-z0-9-]{1,64}", args.build):
        raise ValueError("Invalid build ID")
    platform = args.platform
    name = "smash-" + platform.split("-")[0] + "-" + args.build[:20]
    windows = platform == "windows-x64"
    script = (
        ROOT / "infra/gcp" / ("windows-startup.ps1" if windows else "linux-startup.sh")
    )
    if getattr(args, "smoke", False):
        script = (
            ROOT / "infra/gcp" / ("smoke-windows.ps1" if windows else "smoke-linux.sh")
        )
    max_seconds = 600 if getattr(args, "smoke", False) else CONFIG["maxRunSeconds"]
    prefix = f"gs://{CONFIG['bucket']}/jobs/{args.build}"
    status = prefix + "/" + platform + "/status.json"
    flags = [
        "--zone=" + CONFIG["zone"],
        "--machine-type=" + CONFIG["machineType"],
        "--network=release-builds",
        "--subnet=release-builds",
        "--image-project=" + ("windows-cloud" if windows else "ubuntu-os-cloud"),
        "--image-family=" + ("windows-2022" if windows else "ubuntu-2404-lts-amd64"),
        "--boot-disk-size=100GB",
        "--boot-disk-type=pd-balanced",
        "--boot-disk-auto-delete",
        "--service-account=" + CONFIG["workerServiceAccount"],
        "--scopes=cloud-platform",
        "--metadata=release-bucket="
        + CONFIG["bucket"]
        + ",release-build="
        + args.build
        + ",release-platform="
        + platform,
        "--metadata-from-file="
        + ("windows-startup-script-ps1" if windows else "startup-script")
        + "="
        + str(script),
        "--max-run-duration=" + str(max_seconds) + "s",
        "--instance-termination-action=DELETE",
        "--no-restart-on-failure",
        "--labels=purpose=release-build,platform=" + platform,
    ]
    if getattr(args, "smoke", False):
        original = (
            ROOT
            / "infra/gcp"
            / ("windows-startup.ps1" if windows else "linux-startup.sh")
        )
        flags = [
            (
                flag + ",validation-script=" + str(original)
                if flag.startswith("--metadata-from-file=")
                else flag
            )
            for flag in flags
        ]
    try:
        cloud("compute", "instances", "create", name, *flags)
        deadline = time.monotonic() + max_seconds
        while time.monotonic() < deadline:
            result = subprocess.run(
                ["gcloud", "storage", "cat", status, "--project=" + CONFIG["project"]],
                text=True,
                capture_output=True,
            )
            if result.returncode == 0:
                report = json.loads(result.stdout)
                print(json.dumps(report), flush=True)
                if not report.get("success"):
                    raise RuntimeError(
                        f"{platform} failed; inspect {prefix}/{platform}/build.log"
                    )
                return
            state = cloud(
                "compute",
                "instances",
                "describe",
                name,
                "--zone=" + CONFIG["zone"],
                "--format=value(status)",
                capture=True,
            ).stdout.strip()
            if state not in {"RUNNING", "PROVISIONING", "STAGING"}:
                raise RuntimeError(f"{platform} stopped without a completion report")
            time.sleep(20)
        raise TimeoutError("Builder exceeded its maximum duration")
    finally:
        # Preserve boot/install failures too, before deleting the VM.
        serial = subprocess.run(
            [
                "gcloud",
                "compute",
                "instances",
                "get-serial-port-output",
                name,
                "--zone=" + CONFIG["zone"],
                "--project=" + CONFIG["project"],
            ],
            capture_output=True,
            text=True,
        )
        if serial.returncode == 0:
            log = Path("/tmp/" + name + ".log")
            log.write_text(serial.stdout)
            subprocess.run(
                [
                    "gcloud",
                    "storage",
                    "cp",
                    str(log),
                    prefix + "/" + platform + "/serial.log",
                    "--project=" + CONFIG["project"],
                ],
                check=False,
            )
        subprocess.run(
            [
                "gcloud",
                "compute",
                "instances",
                "delete",
                name,
                "--zone=" + CONFIG["zone"],
                "--project=" + CONFIG["project"],
                "--quiet",
            ],
            check=False,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["stage", "run"])
    parser.add_argument("--smoke", action="store_true")
    parser.add_argument("--tag")
    parser.add_argument("--commit")
    parser.add_argument("--build", required=True)
    parser.add_argument("--platform", choices=["linux-x64", "windows-x64"])
    args = parser.parse_args()
    (stage if args.action == "stage" else run)(args)
