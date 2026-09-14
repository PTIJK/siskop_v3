#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
# This database is dedicated to destructive integration tests. Never substitute
# a development/Cloud SQL URL: tests clear tenant tables between cases.
export DATABASE_URL='postgresql://postgres:local-test-only@127.0.0.1:55433/siskop_landing_test'
export RESEND_API_KEY=''
export NODE_ENV=test
export FIREBASE_ACCOUNT_PROVISIONING_ENABLED=false
(cd packages/types && ../../node_modules/.bin/tsc)
node --input-type=module -e "await import('./packages/types/dist/index.js')"
(cd apps/backend && ./node_modules/.bin/prisma migrate deploy && ./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run --coverage)
(cd apps/frontend && ./node_modules/.bin/tsc --noEmit)
node --test infra/tenant-web/server.test.mjs
