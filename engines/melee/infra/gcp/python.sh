#!/bin/sh
# Google's minimal CLI image bundles Python without placing it on PATH.
set -eu
exec "$(gcloud info --format='value(basic.python_location)')" "$@"
