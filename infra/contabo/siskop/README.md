# SISKOP Contabo migration

This directory controls SISKOP only. Never run it from a Sentryx checkout or pass Sentryx container names, credentials, volumes or database URLs.

The target is `/srv/siskop/staging` on `vmi3303548`, Compose project `siskop-staging`, database container `siskop-postgres-staging`, database `siskop_staging`. PostgreSQL is on the internal `siskop-staging-database` network with **no published port**. API and HTTPS proxy candidates run through the `application` profile. They are not serving the live website yet.

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

## Candidate deployment and recovery verified on 28 October 2026

- The isolated API and unprivileged HTTPS proxy run with separate limits. Public HTTPS is `https://siskop-api.inovasijayakarsa.id:18443`; PostgreSQL remains private. The nonstandard port preserves Sentryx's existing Cloudflare-only 80/443 firewall rules. Frontend addresses stay unchanged.
- Four parent DNS NS records delegate only `_acme-challenge.siskop-api` to the dedicated Google zone `siskop-api-acme`. A dedicated certificate lineage and fixed-zone DNS hooks passed a real renewal dry run. Renewal reloads only `siskop-proxy-staging`.
- The initial HTTP-challenge diagnostic added a SISKOP-only HTTP virtual host and one graceful shared Nginx reload. Existing site files were byte-identical and the master remained running. That challenge path is unused; ongoing certificates use DNS validation and the separate proxy. Do not reuse the legacy shared-host ingress installer.
- Candidate API checks proved restricted database access, transaction rollback, Firebase lookup permissions, and GCS write/read/delete using a new temporary probe object. Xendit remains in test mode. No existing business rows were modified by these probes.
- Dedicated runtime, backup and certificate identities are installed with separate permissions. Following explicit user approval, the deployer identity can read only SISKOP registry images/build results and the private release mailbox, and create receipts. Its root-only key is not mounted into the API. CI receives no VPS login or database credential.
- `siskop-backup.timer` is installed hourly at minute 12 UTC. It does nothing until `database-authoritative.json` exists, which can be written only after source fencing and final fresh-database promotion. This permits an authoritative backup before public routing opens. Encrypted rehearsal backups were uploaded and restored locally, matching all 61 tables and 110 rows. Retention is two days hourly, fourteen days daily, twenty-eight days weekly; initial recovery archives are preserved.
- A second fresh read-only source export, `pre-contabo/20261028-pre-cutover-review/`, also passed a complete local restore and has encrypted off-host copies and verification evidence. This is preparation, not a final write-frozen export.
- The new `siskop-deploy.timer` polls a private Google Storage mailbox over outbound HTTPS; no SSH/firewall change is required. `deploy_host.py` accepts only tested main builds from the exact SISKOP trigger/account and immutable SISKOP image digests. It is held until `database-authoritative.json` exists and while `deployment-hold.json` exists. The separate `traffic-switched.json` records completion of public routing, rather than conflating database authority with successful publication.
- `RELEASE_BACKEND=contabo` prepares coordinated API/central/tenant publication and OIDC scheduler readiness. Default release behavior remains Cloud Run until the controlled trigger override. This path still needs a real Cloud Build rehearsal and live release verification.
- `restore_candidate.py` restores only into a new allowlisted SISKOP database and compares every table checksum. `promote_candidate.py` requires documented source fencing and a newer verified final export; it preserves the old rehearsal database instead of deleting it. The final promotion has not run.
- Fresh-destination rehearsal restored the second archive into `siskop_cutover_ae2af97f92a2`, preserving the canonical rehearsal copy and matching all 61 tables/110 rows. PDF generation also succeeded inside the bounded API container.
- External API/database uptime, 90-minute backup freshness, missing health reporter and local API/certificate/disk alert policies are configured for the user-approved `yudith.octo@gmail.com`. Policies remain disabled before cutover. The backup identity has only backup-object creation and metric writing; its OAuth scopes are limited to storage and monitoring writes, with no general cloud-platform scope. A SISKOP-only health timer will publish metrics after authority switches.

## Required before traffic can move

1. Complete integration, capacity, migration-role and build-to-host release checks. Verify external availability and backup-freshness alerts reach the approved operator, `yudith.octo@gmail.com`.
2. Rehearse final restore/promotion on disposable SISKOP targets; preserve both source and rehearsal data. Never reset the populated rehearsal database with `restore_initial.py`.
3. Disable the old release trigger and pause both scheduled jobs, block old API invocation, drain writers, fence the source and take a new final consistent backup. Verify its encrypted off-host copy and clean restore before promotion.
4. Promote the verified fresh destination under the deployment hold, publish both forwarding routes, retarget/authenticate the existing scheduled jobs and verify application behavior.
5. Mark live authority only after routing succeeds, take an authoritative Contabo backup, enable alerts and resume the Contabo release path. Keep Supabase frozen; after new writes it is not a safe automatic rollback target.

The old Cloud SQL data remains unrecovered and outside this migration. Preserve that instance separately. Supabase and all current production routing remain unchanged.
