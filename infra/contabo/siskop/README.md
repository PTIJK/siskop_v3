# SISKOP Contabo migration

This directory controls SISKOP only. Never run it from a Sentryx checkout or pass Sentryx container names, credentials, volumes or database URLs.

The target is `/srv/siskop/staging` on `vmi3303548`, Compose project `siskop-staging`, database container `siskop-postgres-staging`, database `siskop_staging`. PostgreSQL is on the internal `siskop-staging-database` network with **no published port**. API deployment is opt-in through the `application` profile; it has not been activated.

## Implemented on 28 October 2026

- A snapshot-consistent SISKOP Supabase export is encrypted using CMS AES-256-GCM. The source was read only.
- A clean local PostgreSQL 17 restore matched every one of the 61 tables and 110 rows, including Prisma migration history.
- Encrypted archive, encrypted manifest, checksum file and restore report were copied to the private bucket `gs://siskop-d0f8c-db-backups/pre-contabo/2026-10-28-initial/`. Uniform bucket-level access and public access prevention are enabled.
- A pinned PostgreSQL 17 image runs in a new isolated SISKOP container with a 2 GiB memory limit and two-vCPU ceiling.
- The same backup was restored into that container for rehearsal. Table counts/content checksums match the source snapshot, and the restricted runtime role can read the application data through destination RLS policies.
- All nine preexisting containers retained their recorded identities, start times and restart counts after provisioning and restore. No Sentryx database was queried or changed, and no preexisting service was restarted.

**The VPS database is a rehearsal copy. The live application remains on Supabase. Do not promote this copy without a new final export under a write freeze.**

## Local backup and recovery material

The encrypted local archive and verification reports are under the Git-ignored directory `apps/backend/scripts/data/contabo-migration/`. Its `keys/backup-private.pem` is the recovery key; permissions restrict local access. The key is deliberately absent from the VPS, backup bucket, Git and build contexts. Keep an additional secure recovery-key copy under the operator's control before relying on these backups for long-term recovery. Losing the key prevents decryption.

Only the public recipient certificate may be placed on the VPS for future backup encryption. Never put the private key into an application image, runtime environment, build log, shared Sentryx directory or backup bucket.

To take another source backup, use a **new** private output directory:

```sh
python3 infra/contabo/siskop/backup_source.py \
  --source-env apps/backend/.env.supabase.local \
  --output apps/backend/scripts/data/contabo-migration/backup-UNIQUE-TIMESTAMP \
  --recipient apps/backend/scripts/data/contabo-migration/keys/backup-recipient.pem
```

The helper accepts only the exact SISKOP Singapore project. It holds a read-only repeatable-read snapshot while producing table manifests and the custom-format dump. It refuses unexpected PostgreSQL major versions or unreviewed large objects. Only `public` application objects are included; successful restore and application verification are required before cutover.

```sh
python3 infra/contabo/siskop/verify_backup.py \
  --backup apps/backend/scripts/data/contabo-migration/backup-UNIQUE-TIMESTAMP \
  --private-key apps/backend/scripts/data/contabo-migration/keys/backup-private.pem
```

The verifier creates its own temporary local cluster, restores with errors fatal, compares every table and removes only that disposable cluster. It never restores over an existing database. Its default PostgreSQL binary directory is the local Homebrew PostgreSQL 17 installation; `--pg-bin` can select an equivalent local installation.

Content checksums use a normalized UTC representation. The archive additionally has a SHA-256 digest, and encrypted artifacts have separate checksums. Checksum manifests contain no row contents.

## Host safeguards

`bootstrap_host.py` refuses an existing deployment directory and only installs the allowlisted SISKOP files. It creates separate random database passwords without printing them.

`siskopctl.py` verifies the host, root-owned deployment marker, image digest, data paths, labels, mounts and private network before host operations. It exposes only `db-up` and `status`; it has no general Docker-command passthrough, global cleanup or Sentryx target option.

`restore_initial.py` refuses a nonempty database, preexisting destination roles or an archive checksum mismatch. It is **not** a refresh/reset command. The deployed rehearsal database is already populated, so rerunning this restore must fail. A final cutover requires a separate reviewed fresh-destination procedure that preserves the rehearsal copy; do not remove its safeguards to force a restore.

SISKOP runtime, migration, owner and backup roles are separate. Backend-wide policies preserve the existing trusted-backend authorization model; tenant authorization still belongs to application code and must be verified. Runtime cannot access `_prisma_migrations`, create roles/databases, or bypass RLS.

## API preparation implemented locally

- `apps/backend/src/hosting/contabo.ts`: opt-in runtime requiring the private SISKOP database, GCS storage, release ID and gateway configuration.
- `contabo-ingress.ts`: rejects direct browser traffic unless signed by a SISKOP central/tenant gateway. Scheduler and exact payment-callback routes retain their own authentication requirements.
- `scheduler-identity.ts`: verifies Google identity tokens for the configured audience and exact scheduler service account, in addition to the existing scheduler secret.
- `upload-storage.ts` and `gcs-uploads.ts`: preserve relative upload URLs using the existing private GCS bucket; local development retains filesystem storage. Both upload paths validate actual file signatures before persisting.
- `infra/central-gateway/`: fixed-upstream forwarding service with signed requests, cookie/status streaming and no automatic mutation retries. It has no database credentials.
- `cloudbuild-candidate.yaml`: manual candidate image builds only; it performs no deployment or traffic changes. Production release automation has **not** been switched to Contabo.

## Required before traffic can move

1. Obtain DNS access for the approved `siskop-api.inovasijayakarsa.id` hostname. The currently signed-in Vercel account's three teams do not contain `inovasijayakarsa.id`; nameservers are still Vercel. Do not edit `sentryxmonitor.com` DNS.
2. Establish SISKOP HTTPS ingress without changing Sentryx virtual hosts, certificates or upstreams. Any change to shared host ingress must be explicitly scoped and checked against the user's requirement to leave existing services untouched.
3. Provision separate SISKOP runtime/backup Google identities, restricted credential delivery and registry access. No new runtime key or Google identity has been installed yet.
4. Implement the restricted build-to-VPS release wrapper, local migration execution, coordinated gateway/Hosting publication and scheduler maintenance hold. Do not route normal `main` deployments to the rehearsal database prematurely.
5. Add automatic SISKOP-only encrypted off-host backups, failure alerts and rotation. The initial verified export is complete; recurring destination backups are **not yet configured**.
6. Build and deploy API/gateway candidates, verify real Firebase/GCS/email/test-payment integration, and run representative capacity and recovery tests.
7. Schedule a write freeze, fence old revisions and external writers, take/verify a fresh final export, restore into a fresh SISKOP destination, coordinate routing and resume only one authoritative writer.

The old Cloud SQL data remains unrecovered and outside this migration. Preserve that instance separately. Supabase and all current production routing remain unchanged.
