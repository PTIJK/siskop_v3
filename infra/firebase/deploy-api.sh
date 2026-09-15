#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
image_ref="${1:?Pass the immutable Artifact Registry image digest from a successful build}"
if [[ "$image_ref" != asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api@sha256:* ]]; then
  echo "Expected the staging API image digest." >&2
  exit 1
fi
shift
env_file=infra/firebase/staging-env.yaml
if [[ "${RELEASE_TENANT_HOSTING:-false}" == true ]]; then
  mkdir -p .release
  env_file=.release/tenant-api-env.yaml
  cp infra/firebase/staging-env.yaml "$env_file"
  printf '\nTENANT_DOMAINS_ENABLED: "true"\nTENANT_DOMAIN_RENAME_ENABLED: "%s"\n' "${RELEASE_TENANT_RENAME_ENABLED:-false}" >> "$env_file"
fi
if [[ "${RELEASE_TENANT_LOGIN_SELECTION_ENABLED:-false}" == true && "${RELEASE_TENANT_HOSTING:-false}" != true ]]; then
  echo "Tenant login selection requires coordinated tenant hosting." >&2
  exit 1
fi
if [[ "${RELEASE_TENANT_HOSTING:-false}" == true ]]; then
  printf '\nTENANT_LOGIN_SELECTION_ENABLED: "%s"\nTENANT_SWITCHING_ENABLED: "%s"\n' "${RELEASE_TENANT_LOGIN_SELECTION_ENABLED:-false}" "${RELEASE_TENANT_SWITCHING_ENABLED:-false}" >> "$env_file"
fi
gcloud run deploy siskop-staging-api \
  --project=siskop-d0f8c --region=asia-southeast2 \
  --image="$image_ref" \
  --service-account=siskop-staging-api@siskop-d0f8c.iam.gserviceaccount.com \
  --add-cloudsql-instances=siskop-d0f8c:asia-southeast2:siskop-staging \
  --update-secrets=DATABASE_URL=DATABASE_URL:2,JWT_SECRET=JWT_SECRET:1,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:1,XENDIT_SECRET_KEY=XENDIT_SECRET_KEY:1,XENDIT_WEBHOOK_TOKEN=XENDIT_WEBHOOK_TOKEN:1,TENANT_GATEWAY_SECRET=TENANT_GATEWAY_SECRET:1,SCHEDULER_SECRET=SCHEDULER_SECRET:1 \
  --env-vars-file="$env_file" \
  --execution-environment=gen2 --cpu=1 --memory=1Gi --concurrency=20 \
  --min-instances=0 --max-instances=1 --timeout=300 --cpu-throttling \
  --add-volume='name=uploads,type=cloud-storage,bucket=siskop-d0f8c-staging-uploads,mount-options=uid=1000;gid=1000' \
  --add-volume-mount=volume=uploads,mount-path=/mnt/uploads \
  --quiet "$@"
