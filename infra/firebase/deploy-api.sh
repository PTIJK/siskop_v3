#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
image_ref="${1:?Pass the immutable Artifact Registry image digest from a successful build}"
if [[ "$image_ref" != asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api@sha256:* ]]; then
  echo "Expected the staging API image digest." >&2
  exit 1
fi
shift
gcloud run deploy siskop-staging-api \
  --project=siskop-d0f8c --region=asia-southeast2 \
  --image="$image_ref" \
  --service-account=siskop-staging-api@siskop-d0f8c.iam.gserviceaccount.com \
  --add-cloudsql-instances=siskop-d0f8c:asia-southeast2:siskop-staging \
  --set-secrets=DATABASE_URL=DATABASE_URL:2,JWT_SECRET=JWT_SECRET:1,JWT_REFRESH_SECRET=JWT_REFRESH_SECRET:1,XENDIT_SECRET_KEY=XENDIT_SECRET_KEY:1,XENDIT_WEBHOOK_TOKEN=XENDIT_WEBHOOK_TOKEN:1 \
  --env-vars-file=infra/firebase/staging-env.yaml \
  --execution-environment=gen2 --cpu=1 --memory=1Gi --concurrency=20 \
  --min-instances=0 --max-instances=1 --timeout=60 --cpu-throttling \
  --add-volume='name=uploads,type=cloud-storage,bucket=siskop-d0f8c-staging-uploads,mount-options=uid=1000;gid=1000' \
  --add-volume-mount=volume=uploads,mount-path=/mnt/uploads \
  --quiet "$@"
