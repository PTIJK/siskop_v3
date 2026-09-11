#!/usr/bin/env bash
# Run once as a project administrator. Uses the caller's gcloud account/ADC.
set -euo pipefail
cd "$(dirname "$0")/../.."
project=siskop-d0f8c
region=asia-southeast2
builder="siskop-cloud-build@$project.iam.gserviceaccount.com"
migrator="siskop-staging-migrate@$project.iam.gserviceaccount.com"
runtime="siskop-staging-api@$project.iam.gserviceaccount.com"

for account_id in siskop-cloud-build siskop-staging-migrate; do
  if ! gcloud iam service-accounts describe "$account_id@$project.iam.gserviceaccount.com" --project="$project" >/dev/null 2>&1; then
    gcloud iam service-accounts create "$account_id" --project="$project" --display-name="$account_id" --quiet
  fi
done
for role in logging.logWriter cloudbuild.builds.viewer run.developer firebasehosting.admin serviceusage.serviceUsageConsumer; do
  gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$builder" \
    --role="roles/$role" --condition=None --quiet --format='value(etag)'
done
gcloud projects add-iam-policy-binding "$project" --member="serviceAccount:$migrator" \
  --role=roles/cloudsql.client --condition=None --quiet --format='value(etag)'
gcloud secrets add-iam-policy-binding DATABASE_URL --project="$project" \
  --member="serviceAccount:$migrator" --role=roles/secretmanager.secretAccessor --quiet --format='value(etag)'
for identity in "$runtime" "$migrator"; do
  gcloud iam service-accounts add-iam-policy-binding "$identity" --project="$project" \
    --member="serviceAccount:$builder" --role=roles/iam.serviceAccountUser --quiet --format='value(etag)'
done
gcloud artifacts repositories add-iam-policy-binding siskop-staging --location="$region" --project="$project" \
  --member="serviceAccount:$builder" --role=roles/artifactregistry.writer --quiet --format='value(etag)'
if ! gcloud storage buckets describe "gs://$project-deployments" --project="$project" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$project-deployments" --location="$region" --project="$project" \
    --uniform-bucket-level-access --public-access-prevention --quiet
fi
gcloud storage buckets add-iam-policy-binding "gs://$project-deployments" --project="$project" \
  --member="serviceAccount:$builder" --role=roles/storage.objectUser --quiet --format='value(etag)'
echo 'Release identities and lock bucket configured. No deployment was started.'
