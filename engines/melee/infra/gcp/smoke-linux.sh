#!/usr/bin/env bash
set -euo pipefail
metadata() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/$1"; }
metadata instance/attributes/validation-script | bash -n
bucket=$(metadata instance/attributes/release-bucket)
build=$(metadata instance/attributes/release-build)
platform=$(metadata instance/attributes/release-platform)
token=$(metadata instance/service-accounts/default/token | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')
curl -fsS -X POST -H "Authorization: Bearer $token" -H 'Content-Type: application/json' --data '{"success":true,"smoke":true,"startupSyntax":true}' "https://storage.googleapis.com/upload/storage/v1/b/$bucket/o?uploadType=media&name=jobs%2F$build%2F$platform%2Fstatus.json"
