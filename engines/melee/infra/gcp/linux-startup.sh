#!/usr/bin/env bash
set -euo pipefail
exec > >(tee -a /var/log/opensmash-build.log) 2>&1
metadata() { curl --fail --silent -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
export RELEASE_BUCKET=$(metadata release-bucket)
export RELEASE_BUILD=$(metadata release-build)
export RELEASE_PLATFORM=$(metadata release-platform)
reported=false
finish() {
  if [[ "$reported" != true ]]; then
    token=$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token | /usr/bin/python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])') || return
    curl -fsS -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data '{"success":false,"phase":"bootstrap"}' "https://storage.googleapis.com/upload/storage/v1/b/$RELEASE_BUCKET/o?uploadType=media&name=jobs%2F$RELEASE_BUILD%2F$RELEASE_PLATFORM%2Fstatus.json" || true
  fi
  # Leave the VM running until the coordinator deletes it. If the coordinator
  # disappeared, the Compute Engine deadline still deletes the VM and boot disk.
}
trap finish EXIT
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3-venv python3-dev curl git xz-utils build-essential clang g++-14 ccache ninja-build pkg-config libgtk-3-dev libasound2-dev libpulse-dev libudev-dev libevdev-dev libxrandr-dev libxi-dev libx11-xcb-dev libxinerama-dev libxcursor-dev libgl1-mesa-dev libvulkan-dev libusb-1.0-0-dev libbluetooth-dev libwayland-dev libxkbcommon-dev libhidapi-dev
# Resolve the current Node 22 binary and verify the official archive checksum.
cd /tmp
node_archive=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '$2 ~ /linux-x64.tar.xz$/ {print $2}')
curl -fsSLO "https://nodejs.org/dist/latest-v22.x/$node_archive"
curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | grep " $node_archive$" | sha256sum -c -
tar -xJf "$node_archive" -C /usr/local --strip-components=1
python3 -m venv /opt/opensmash-python
export PATH=/opt/opensmash-python/bin:$PATH
python -m pip install google-cloud-storage
mkdir -p /opt/opensmash
cd /opt/opensmash
python - <<'PY'
import os,tarfile
from google.cloud import storage
b=storage.Client().bucket(os.environ['RELEASE_BUCKET'])
b.blob('jobs/'+os.environ['RELEASE_BUILD']+'/source.tar.gz').download_to_filename('/tmp/source.tar.gz')
with tarfile.open('/tmp/source.tar.gz') as t:t.extractall('.',filter='data')
PY
set +e
python infra/gcp/worker.py --build "$RELEASE_BUILD" --platform "$RELEASE_PLATFORM"
result=$?
python - <<'PY'
import os
from google.cloud import storage
from pathlib import Path
bucket=storage.Client().bucket(os.environ['RELEASE_BUCKET'])
status=Path('build/gcp-status.json')
storage.Client().bucket(os.environ['RELEASE_BUCKET']).blob('jobs/'+os.environ['RELEASE_BUILD']+'/'+os.environ['RELEASE_PLATFORM']+'/build.log').upload_from_filename('/var/log/opensmash-build.log')
if status.exists(): bucket.blob('jobs/'+os.environ['RELEASE_BUILD']+'/'+os.environ['RELEASE_PLATFORM']+'/status.json').upload_from_filename(status)
PY
if [[ $? == 0 ]]; then reported=true; fi
exit "$result"
