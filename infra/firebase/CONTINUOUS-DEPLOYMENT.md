# Deploy main with Cloud Build

Target: **https://siskop-d0f8c.web.app**, with API `siskop-staging-api` in
`asia-southeast2`. This remains the existing Firebase/Xendit sandbox environment.

The regional Cloud Build trigger `siskop-main-deploy` watches
`PTIJK/siskop_v3` with branch pattern `^main$`. Merging a GitHub pull request updates
main and starts a release. Direct pushes to main also trigger it. Open pull
requests run GitHub Actions checks; feature branches cannot publish through this
pipeline. Repository branch protection controls who can merge or push main.

## Release sequence

1. Start a disposable PostgreSQL 18 container, install dependencies with Node 22
   and pnpm 11.19.0, run release safety tests, lint, typecheck, database migrations,
   application tests with coverage, and workspace builds. No staging database
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
and installed for `PTIJK/siskop_v3`. Then create the trigger:

```sh
gcloud builds triggers create github --project=siskop-d0f8c \
  --region=asia-southeast2 --trigger-config=infra/firebase/release-trigger.yaml
```

For an existing trigger, update its configuration instead of creating a duplicate:

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
