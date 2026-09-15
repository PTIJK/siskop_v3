#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../apps/backend"
export DATABASE_URL='postgresql://postgres:local-test-only@127.0.0.1:55433/siskop_tenant_preview'
export NODE_ENV=test PORT=3051
export FIREBASE_PROJECT_ID=demo-siskop-tenants FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9109
export FIREBASE_ACCOUNT_PROVISIONING_ENABLED=true
export JWT_SECRET=local-preview-access-secret JWT_REFRESH_SECRET=local-preview-refresh-secret
export TENANT_BASE_DOMAIN=koperasi.localhost TENANT_DEV_PORT=3050 TENANT_DOMAINS_ENABLED=true TENANT_DOMAIN_RENAME_ENABLED=true
export TENANT_GATEWAY_SECRET=local-tenant-preview-key-32-characters-only
export PUBLIC_APP_URL=http://localhost:3050 CORS_ORIGIN=http://localhost:3050
export XENDIT_SECRET_KEY='' XENDIT_WEBHOOK_TOKEN='' RESEND_API_KEY=''
./node_modules/.bin/prisma migrate deploy
./node_modules/.bin/tsx scripts/preview-tenant-domains.ts
exec ./node_modules/.bin/tsx src/main.ts
