#!/usr/bin/env bash
set -euo pipefail
# The stable Cloud SDK image bundles Python without putting it on PATH.
python_binary="$(gcloud info --format='value(basic.python_location)')"
# The minimal image ships the SDK's CA bundle, not Debian's ca-certificates.
sdk_root="$(gcloud info --format='value(installation.sdk_root)')"
export SSL_CERT_FILE="$sdk_root/lib/third_party/certifi/cacert.pem"
test -r "$SSL_CERT_FILE"
exec "$python_binary" infra/firebase/release.py "$@"
