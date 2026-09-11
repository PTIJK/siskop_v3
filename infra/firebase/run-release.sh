#!/usr/bin/env bash
set -euo pipefail
# The stable Cloud SDK image bundles Python without putting it on PATH.
python_binary="$(gcloud info --format='value(basic.python_location)')"
exec "$python_binary" infra/firebase/release.py "$@"
