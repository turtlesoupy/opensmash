#!/usr/bin/env python3
"""Tripo3D API front-end (v2 openapi) — alternative to Meshy.

Subcommands:
  upload <image.png>                      -> image_token
  img3d <image_token> [--faces 4000]      image_to_model -> task id
  rig <model_task_id>                     animate_rig -> task id
  status <task_id>                        poll task
  download <task_id> <out.glb>            fetch model/rigged glb

Key from TRIPO_API_KEY in .env next to this script.
"""
import argparse
import json
import time
import os
import subprocess
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KEY = os.environ.get("TRIPO_API_KEY")
if not KEY:
    env_path = os.path.join(ROOT, ".env")
    if os.path.isfile(env_path):
        KEY = next((line.split("=", 1)[1].strip() for line in open(env_path)
                    if line.startswith("TRIPO_API_KEY=")), None)
if not KEY:
    raise RuntimeError("TRIPO_API_KEY is missing; set it in the environment or .env")
BASE = "https://api.tripo3d.ai/v2/openapi"
# Tripo rejects urllib's generic client signature at its edge (403 / 1010).
USER_AGENT = "OpenSmash/1.0 (+https://smash.fun)"


def http(url, body=None):
    req = urllib.request.Request(url, method="POST" if body is not None else "GET")
    req.add_header("Authorization", f"Bearer {KEY}")
    req.add_header("User-Agent", USER_AGENT)
    data = None
    if body is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(body).encode()
    # 429 "exceeded the limit of generation" is Tripo's concurrent-task cap,
    # not a failure: wait for the Retry-After window (or 20s) and re-submit,
    # for up to ~12 minutes, so a batch running more workers than the cap
    # self-throttles instead of failing characters.
    waited = 0.0
    while True:
        try:
            with urllib.request.urlopen(req, data, timeout=180) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")
            if (e.code == 429 or e.code >= 500) and waited < 720:
                # 5xx: Tripo's gateway hiccups for a few seconds at a time
                try:
                    delay = float(e.headers.get("Retry-After") or 20)
                except ValueError:
                    delay = 20.0
                delay = max(5.0, min(delay, 120.0)) if e.code == 429 else 10.0
                print(f"tripo: 429 rate/concurrency limit, waiting {delay:.0f}s", file=sys.stderr, flush=True)
                time.sleep(delay)
                waited += delay
                continue
            raise RuntimeError(f"HTTP {e.code} from {url}: {detail}") from e


def cmd_upload(a):
    out = subprocess.run(
        ["curl", "-s", "--user-agent", USER_AGENT, f"{BASE}/upload", "-H", f"Authorization: Bearer {KEY}",
         "-F", f"file=@{a.image}"], capture_output=True, text=True)
    print(out.stdout)


def cmd_img3d(a):
    body = {"type": "image_to_model",
            "file": {"type": "png", "file_token": a.image_token},
            "face_limit": a.faces, "texture": True}
    if a.model:
        body["model_version"] = a.model
    print(json.dumps(http(f"{BASE}/task", body)))


def cmd_rig(a):
    body = {"type": "animate_rig", "original_model_task_id": a.task_id,
            "out_format": "glb"}
    print(json.dumps(http(f"{BASE}/task", body)))


def cmd_balance(a):
    """Credit balance. Bracketing a task with this is the only way to see
    what Tripo actually charged — task payloads carry no cost field."""
    print(json.dumps(http(f"{BASE}/user/balance")["data"]))


def cmd_status(a):
    d = http(f"{BASE}/task/{a.task_id}")["data"]
    print(json.dumps({k: d.get(k) for k in
                      ("task_id", "type", "status", "progress",
                       "consumed_credit", "output")})[:700])


def cmd_download(a):
    d = http(f"{BASE}/task/{a.task_id}")["data"]
    out = d.get("output") or {}
    url = out.get("model") or out.get("pbr_model") or out.get("base_model") or out.get("rigged_model")
    if not url:
        print(json.dumps({"error": "no model url", "output_keys": list(out.keys()),
                          "status": d.get("status")}))
        sys.exit(1)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=600) as r, open(a.out, "wb") as f:
        f.write(r.read())
    print(json.dumps({"saved": a.out, "bytes": os.path.getsize(a.out)}))


def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)
    u = sub.add_parser("upload"); u.add_argument("image"); u.set_defaults(fn=cmd_upload)
    i = sub.add_parser("img3d"); i.add_argument("image_token"); i.add_argument("--faces", type=int, default=4000); i.add_argument("--model", default="v3.0-20250812"); i.set_defaults(fn=cmd_img3d)
    r = sub.add_parser("rig"); r.add_argument("task_id"); r.set_defaults(fn=cmd_rig)
    s = sub.add_parser("status"); s.add_argument("task_id"); s.set_defaults(fn=cmd_status)
    d = sub.add_parser("download"); d.add_argument("task_id"); d.add_argument("out"); d.set_defaults(fn=cmd_download)
    b = sub.add_parser("balance"); b.set_defaults(fn=cmd_balance)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
