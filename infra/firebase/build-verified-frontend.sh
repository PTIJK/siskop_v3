#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
test "$(node infra/firebase/check-ci-proof.mjs)" = reuse-ci
echo 'Building an identical, GitHub-verified source tree; full-suite results are reused.'
# No integration tests run in this path, so Chromium, Prisma and backend
# dependencies are unnecessary. The runtime image is still built and checked.
if ! command -v python3 >/dev/null; then
  apt-get update -qq
  apt-get install -y --no-install-recommends python3 >/dev/null
fi
npm install --global pnpm@11.19.0
pnpm --filter @siskop/frontend... --filter @siskop/mobile... install --frozen-lockfile --ignore-scripts --store-dir=.release/pnpm-store --config.verify-store-integrity=true --config.side-effects-cache=false
python3 -m unittest discover -s infra/firebase/tests -v
python3 -m unittest discover -s infra/contabo/siskop -p 'test_*.py' -v
node --test infra/central-gateway/server.test.mjs
node --test infra/tenant-web/server.test.mjs
node --test infra/firebase/scheduler.test.mjs
node --test infra/firebase/ci-proof.test.mjs
pnpm --filter @siskop/types build
node --input-type=module -e "await import('./packages/types/dist/index.js')"
bash infra/firebase/build-web-assets.sh
