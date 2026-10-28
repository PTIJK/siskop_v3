#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# Both full verification and CI reuse publish fresh browser artifacts.
pnpm --filter @siskop/mobile exec vite build
pnpm --filter @siskop/frontend exec vite build --mode staging
node infra/tenant-web/package-member-app.mjs
node --input-type=module -e '
  import fs from "node:fs";
  fs.writeFileSync("apps/frontend/dist/release.json", JSON.stringify({
    commit: process.env.RELEASE_COMMIT, buildId: process.env.RELEASE_BUILD_ID
  }) + "\n");
'
