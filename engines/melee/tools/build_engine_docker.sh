#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 - "$project_dir" <<'PY'
import shutil,sys
from pathlib import Path
p=Path(sys.argv[1])
# Upstream has a hardcoded build/ include path, so isolate the entire build
# tree rather than redirecting configure.py's build-dir into build-linux.
shutil.copytree(p/'melee',p/'build/engine-linux',dirs_exist_ok=True,
               ignore=shutil.ignore_patterns('.git','build','build-linux','__pycache__'))
PY
docker build --platform linux/amd64 -t opensmash-melee-build:local -f "$project_dir/tools/engine.Dockerfile" "$project_dir/tools"
docker run --rm --platform linux/amd64 -v "$project_dir:/work" opensmash-melee-build:local \
    sh -c 'python3 configure.py && ninja -j 6'
python3 - "$project_dir" <<'PY'
import hashlib,json,sys
from pathlib import Path
p=Path(sys.argv[1]); dol=p/'build/engine-linux/build/GALE01/main.dol'
sha=hashlib.sha1(dol.read_bytes()).hexdigest()
expected='08e0bf20134dfcb260699671004527b2d6bb1a45'
report=dict(matching_build_verified=sha==expected,sha1=sha,expected_sha1=expected,output=str(dol),backend='docker-linux-amd64')
(p/'build').mkdir(exist_ok=True)
(p/'build/engine-verification.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
if sha!=expected: sys.exit('Built DOL does not match reference')
PY
