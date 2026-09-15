#!/usr/bin/env bash
set -euo pipefail
pnpm --filter @siskop/types build
pnpm --filter @siskop/frontend exec vite build --mode staging
pnpm --filter @siskop/mobile exec vite build
node infra/tenant-web/package-member-app.mjs
