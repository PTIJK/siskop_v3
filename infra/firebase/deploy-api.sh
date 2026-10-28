#!/usr/bin/env bash
# Deliberately fail before any cloud command: business logic now runs on Contabo.
set -euo pipefail
echo 'Retired: use the coordinated main release with _BACKEND=contabo. See infra/contabo/siskop/README.md.' >&2
exit 1
