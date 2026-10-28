# Deploy main with Cloud Build

Target: **https://siskop-d0f8c.web.app**, forwarding to the dedicated SISKOP API and PostgreSQL cluster on Contabo. This remains the existing Firebase/Xendit sandbox environment. Google hosting, builds, registry, authentication, scheduling, storage and monitoring stay in place.

Current release and backup evidence is in the [migration completion record](../../docs/2026-10-28-contabo-migration-completion.md). The old Google API address is retained only as a database-free compatibility forwarder.

The regional Cloud Build trigger `siskop-main-deploy` watches
`PTIJK/siskop_v3` with branch pattern `^main$`. Merging a GitHub pull request updates
main and starts a release. Direct pushes to main also trigger it. Open pull
requests run GitHub Actions checks; feature branches cannot publish through this
pipeline. Repository branch protection controls who can merge or push main.

## Current release sequence

The authoritative API/database run on Contabo. The Cloud Run business-backend option has been retired. `_BACKEND=contabo` is the only supported mode; verification-only builds do not deploy.

1. Run release safety checks, lint, typechecks, migrations and application tests against a disposable PostgreSQL container, and build the browser assets and API image. Staging database credentials are unavailable to tests.
2. Confirm the commit still matches main and acquire the generation-checked SISKOP release lock. Resolve and protect the immutable API image digest.
3. Validate tenant DNS/HTTPS and both existing SISKOP scheduler targets, then pause new scheduled executions.
4. Write a request to the private SISKOP release mailbox. The dedicated host worker verifies the exact successful main build and approved image, runs migrations with SISKOP's separate migration role, gracefully restarts only the SISKOP API and returns a verified receipt. A failed migration or receipt stops frontend publication.
5. Deploy the database-free central forwarding image, check the Contabo-backed catalog, then publish tenant and central hosting. Verify release markers, tenant workspace and staff/member login pages.
6. Authenticate to the Contabo scheduler readiness endpoint, require the exact deployed build, resume both schedules, rotate protected image tags and release the lock.

The existing Google API URL forwards old integration callbacks to SISKOP on Contabo. It is not a business API deployment target. All forwarding routes go to SISKOP's dedicated API, never to Sentryx.

See the [Contabo operator runbook](../contabo/siskop/README.md) for mailbox boundaries, runtime credentials, migration roles, backups and recovery. Database migrations must remain compatible with the previous API image. Rollback after new writes requires the current authoritative dataset; a pre-cutover source snapshot cannot replace it safely.

## Build performance

Backend images have a [retention policy](ARTIFACT-RETENTION.md): seven days of
history, at least ten recent versions, and protected live/rollback/cache images.
Release candidates are pinned before migration; successful releases rotate those
pins after publication and scheduler verification.

`build-backend.sh` maintains `api:cache-dependencies` and `api:cache-runtime` in
the existing Artifact Registry repository. Cache misses fall back to ordinary
builds; a failed cache upload does not block a verified release image. The
dependency stage is keyed by manifests, lockfile, Prisma schema and
build configuration; application source changes only recompile the application.
System-package layers refresh monthly and Docker checks for updated Node images.
Concurrent builds may replace cache tags, which can affect speed but cannot select
the deployed image: releases still resolve their unique build tag to a digest.

The Docker context allows only backend/shared-package inputs. In particular,
verification's pnpm store, Turbo artifacts and frontend bundles cannot enter it
while the backend builds in parallel. No extra machine-size setting or IAM role
is required. The existing machine size and deployment checks are preserved.

Lint, typechecking, all backend tests with coverage, release tests and browser
bundles still run for each main commit. Backend compilation happens in Docker;
the frontend and mobile bundles are built once after typechecking. Caches do not
skip test results. See [performance measurements](BUILD-PERFORMANCE.md).

## Cloud setup

`setup-release.sh` configures the builder's base logging/build, hosting, registry and lock-bucket access, plus permission to deploy the central forwarding service as its dedicated account. It no longer creates a Cloud SQL/Supabase migrator or grants database-secret access. Existing Contabo-specific mailbox, build attestation, scheduler/OIDC and gateway setup is managed separately in `infra/contabo/siskop`.

The builder has no database credential. The VPS deployer key is restricted to SISKOP image/build reads, release requests and deployment receipts. Runtime, backup, certificate and deployer identities are separate; no identity grants access to Sentryx data.

The regional `siskop-main-deploy` trigger watches `PTIJK/siskop_v3` branch `^main$` with `_BACKEND=contabo`. Preserve the existing trigger ID and full configuration when updating it; importing a configuration without an existing ID may create a duplicate.

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

A failed release keeps its lock until the current build and any tenant rollout have settled. The next current-main build can reclaim it after verifying the previous owner is terminal. If schedulers remain paused, repair the SISKOP release and let its readiness checks resume them; do not force the financial job for a deployment test.

The host worker records deployment receipts and preserves the previous API image. Diagnose failures using SISKOP's private release-state files and container logs. Database rollback is separate from image rollback; never reset staging or modify an applied migration. Before restoring, fence writers, preserve a fresh recovery copy, rehearse an isolated restore and validate the complete dataset.

Use the encrypted off-host Contabo backups if the VPS fails. The private decryption key is kept under operator control outside the VPS and Git. The stopped historical Cloud SQL instance is unrelated to this rollback and remains preserved.
