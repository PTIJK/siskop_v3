#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Match run-release.sh: the stable SDK image's Python is not on PATH.
python_binary="$(gcloud info --format='value(basic.python_location)')"
test -x "$python_binary"
sdk_root="$(gcloud info --format='value(installation.sdk_root)')"
export SSL_CERT_FILE="$sdk_root/lib/third_party/certifi/cacert.pem"
test -r "$SSL_CERT_FILE"
exec "$python_binary" "$@"
