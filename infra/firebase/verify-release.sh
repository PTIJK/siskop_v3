#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
if [[ "${RELEASE_VERIFICATION:-full}" == reuse-ci && -f .release/verification.json ]]; then
  verification_mode="$(node infra/firebase/check-ci-proof.mjs)"
  if [[ "$verification_mode" == reuse-ci ]]; then
    exec bash infra/firebase/build-verified-frontend.sh
  fi
fi
# This container only sees a disposable Postgres container on Cloud Build's network.
# It receives no production secrets and never opens a Cloud SQL connection.
test "$DATABASE_URL" = 'postgresql://postgres:ci-only-password@siskop-ci-postgres:5432/siskop_ci_test'
apt-get update -qq
apt-get install -y --no-install-recommends chromium python3 >/dev/null
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile --store-dir=.release/pnpm-store --config.verify-store-integrity=true --config.side-effects-cache=false
python3 -m unittest discover -s infra/firebase/tests -v
python3 -m unittest discover -s infra/contabo/siskop -p 'test_*.py' -v
node --test infra/central-gateway/server.test.mjs
node --test infra/tenant-web/server.test.mjs
node --test infra/firebase/scheduler.test.mjs
node --test infra/firebase/ci-proof.test.mjs
pnpm --filter @siskop/backend db:generate
pnpm run lint
pnpm run typecheck
node --input-type=module -e "await import('./packages/types/dist/index.js')"
pnpm --filter @siskop/backend exec prisma migrate deploy
pnpm run test
# Typechecks passed above; runtime compilation/import checks run in Docker.
bash infra/firebase/build-web-assets.sh
