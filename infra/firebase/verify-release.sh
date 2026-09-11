#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# This container only sees a disposable Postgres container on Cloud Build's network.
# It receives no production secrets and never opens a Cloud SQL connection.
test "$DATABASE_URL" = 'postgresql://postgres:ci-only-password@siskop-ci-postgres:5432/siskop_ci_test'
apt-get update -qq
apt-get install -y --no-install-recommends chromium python3 >/dev/null
npm install --global pnpm@11.19.0
pnpm install --frozen-lockfile
python3 -m unittest discover -s infra/firebase/tests -v
pnpm --filter @siskop/backend db:generate
pnpm run lint
pnpm run typecheck
pnpm --filter @siskop/backend exec prisma migrate deploy
pnpm run test
pnpm run build
# Explicit staging mode includes the committed public Firebase web configuration.
pnpm --filter @siskop/frontend exec vite build --mode staging
node --input-type=module -e '
  import fs from "node:fs";
  fs.writeFileSync("apps/frontend/dist/release.json", JSON.stringify({
    commit: process.env.RELEASE_COMMIT, buildId: process.env.RELEASE_BUILD_ID
  }) + "\n");
'
