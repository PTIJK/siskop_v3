# Deploy main with Cloud Build

Target: **https://siskop-d0f8c.web.app**, with API `siskop-staging-api` in
`asia-southeast2`. This remains the existing Firebase/Xendit sandbox environment.

Setup status (2026-09-11): the GitHub connection is `COMPLETE`, `siskop-v3` is
linked to `PTIJK/siskop_v3`, and `siskop-main-deploy` is enabled in
`asia-southeast2` (trigger ID `8346644b-e829-4692-8226-fad4c3c5ce28`). The deployment
identities and private lock bucket are configured. The temporary Secret Manager
Admin permission used for connection setup has been removed.

The pipeline files are still on `feature/cloud-build`. Merge that branch into
main to start the first automatic deployment; creating the trigger did not
publish the site or migrate its database.

Verification: commit `719b3ae` passed the full
[Cloud Build verification run](https://console.cloud.google.com/cloud-build/builds;region=asia-southeast2/37b3a90e-9011-4668-a6da-61ca558d8a44?project=866351101735)
with `_DEPLOY=false`: 377 application tests, 14 release safety tests, lint,
typechecks, frontend builds, and the backend container startup check. The
[deployment account access check](https://console.cloud.google.com/cloud-build/builds;region=asia-southeast2/07e9d6e2-f4e4-490d-b54a-f60b2d7810fb?project=866351101735)
also passed for Cloud Run, Firebase Hosting, and both runtime identities. These
checks did not migrate Cloud SQL or publish the live site. The first real
deployment remains to be verified after merging the pipeline into main.

The regional Cloud Build trigger `siskop-main-deploy` watches
`PTIJK/siskop_v3` with branch pattern `^main$`. Merging a GitHub pull request updates
main and starts a release. Direct pushes to main also trigger it. Open pull
requests run GitHub Actions checks; feature branches cannot publish through this
pipeline. Repository branch protection controls who can merge or push main.

## Release sequence

1. Start a disposable PostgreSQL 18 container, install dependencies with Node 22
   and pnpm 11.19.0, run release safety tests, lint, typecheck, database migrations,
   application tests with coverage, compiled Node ESM imports, and workspace builds. No staging database
   credentials are available to the tests.
2. Build and push the backend container, including the committed Prisma
   migrations. Build the frontend with `vite build --mode staging` so it includes
   the committed public Firebase web configuration.
3. Confirm the commit still matches main and acquire a generation-checked lock
   in the private `siskop-d0f8c-deployments` bucket. Superseded builds skip
   publishing. Concurrent releases wait; a lock is reclaimed only after Cloud
   Build confirms its owner has finished, failed, timed out, or been cancelled.
4. Resolve the image digest and run `prisma migrate deploy` in the
   `siskop-staging-migrate` Cloud Run Job. A failed migration stops the release.
   The job never seeds or resets the database.
5. Deploy a tagged API revision with no default traffic, then check its health
   and database-backed package catalog. Publish Firebase Hosting only after
   these checks pass. Hosting's `pinTag` binds the frontend to that API revision.
6. Verify the hosted release marker and API catalog, move the direct Cloud Run
   URL to that revision, and release the lock.

If a release fails after acquiring the lock, the next build can recover the
lock after confirming that failure. A failed verification build does not acquire
the lock, migrate Cloud SQL, or publish Hosting. It still produces a test image.

## Cloud setup

`setup-release.sh` configures these identities without creating private keys:

| Identity | Access |
| --- | --- |
| `siskop-cloud-build` | Build logs and build status; Cloud Run deployments; Firebase Hosting; Artifact Registry writer on `siskop-staging`; lock bucket object access; act as the two runtime accounts |
| `siskop-staging-migrate` | Cloud SQL client and read access to `DATABASE_URL` only |
| `siskop-staging-api` | Existing API runtime permissions and application secrets |

The release account does not directly read application secrets. Its permission
to deploy as the runtime accounts is privileged: treat main and changes to this
pipeline as deployment authority. Never configure a PR trigger with this account.

One-time setup as a project administrator:

```sh
CLOUDSDK_CORE_ACCOUNT=yudith.octo@gmail.com bash infra/firebase/setup-release.sh
```

The GitHub host connection is `siskop-github` in `asia-southeast2`; its linked
repository is `siskop-v3`. The Google Cloud Build GitHub app must be authorized
and installed for `PTIJK/siskop_v3`. Import the configuration to create the trigger
or update the existing trigger with the same name:

```sh
gcloud builds triggers import --project=siskop-d0f8c --region=asia-southeast2 \
  --source=infra/firebase/release-trigger.yaml
```

The YAML must be merged into main before the trigger can read it there. Creating
the trigger does not merge the pull request or deploy the current branch.

## Verification and monitoring

Run a verification build from a reviewed checkout, without changing the live site:

```sh
gcloud builds submit . --project=siskop-d0f8c --region=asia-southeast2 \
  --config=infra/firebase/cloudbuild-release.yaml \
  --ignore-file=infra/firebase/release.gcloudignore \
  --gcs-source-staging-dir=gs://siskop-d0f8c-deployments/source \
  --substitutions=_DEPLOY=false --async
```

This upload allowlist excludes private env files, uploads, dependencies and local
state. The only included env file is the **public** `apps/frontend/.env.staging`.
GitHub-triggered builds use committed files and cannot see local ignored secrets.

Watch [Cloud Build history](https://console.cloud.google.com/cloud-build/builds?project=siskop-d0f8c)
or the commit's Cloud Build status in GitHub. A successful deployment publishes
`/release.json` with the commit SHA and build ID. These identifiers contain no
credentials or customer information. Retry the main trigger after resolving a
transient failure; a build for an older main commit will skip publishing.

## Failure recovery

Before Hosting publishes, its existing frontend and pinned API stay active.
Database migrations may already have applied. Keep migrations compatible with
the previous API revision; use additive changes and backfills before removals.
Never rewrite an applied migration. A failed migration may require inspecting
the Cloud Run Job logs and an explicit Prisma migration repair before retrying.

If Hosting has published but a final smoke check fails, inspect the release in
Firebase Hosting and roll back to the previous Hosting release if necessary.
Hosting restores its pinned API reference with it. Restore the direct Cloud Run
service traffic to the same previous revision separately. Database changes are
not rolled back automatically.

Avoid manual deployments while a pipeline release is running; the release lock
coordinates Cloud Build releases, not arbitrary manual Firebase/gcloud commands.
Do not delete the lock while its owner build is active. The next build handles
locks left by terminated builds using object-generation checks.

References: [Cloud Build GitHub connections](https://docs.cloud.google.com/build/docs/automating-builds/github/connect-repo-github?generation=2nd-gen),
[Cloud Build Firebase deployments](https://docs.cloud.google.com/build/docs/deploying-builds/deploy-firebase),
[Firebase Hosting revision pinning](https://firebase.google.com/docs/hosting/cloud-run).
