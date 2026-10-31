# SISKOP Contabo migration

**Live:** API and PostgreSQL are now on Contabo. Both SISKOP Supabase projects were deleted at the user’s request; see [retirement status](../../../docs/2026-10-28-supabase-retirement.md). See [completion evidence](../../../docs/2026-10-28-contabo-migration-completion.md) for the successful release, backup/restore evidence and current operations. Earlier sections below record preparation milestones. Automatic main releases use the Contabo path.

This directory controls SISKOP only. Never run it from a Sentryx checkout or pass Sentryx container names, credentials, volumes or database URLs.

The target is `/srv/siskop/staging` on `vmi3303548`, Compose project `siskop-staging`, database container `siskop-postgres-staging`, database `siskop_staging`. PostgreSQL is on the internal `siskop-staging-database` network with **no published port**. API and HTTPS proxy run through the `application` profile and serve the live SISKOP websites through the existing Google forwarding layers.

## Implemented on 28 October 2026

- A snapshot-consistent SISKOP Supabase export is encrypted using CMS AES-256-GCM. The source was read only.
- A clean local PostgreSQL 17 restore matched every one of the 61 tables and 110 rows, including Prisma migration history.
- Encrypted archive, encrypted manifest, checksum file and restore report were copied to the private bucket `gs://siskop-d0f8c-db-backups/pre-contabo/2026-10-28-initial/`. Uniform bucket-level access and public access prevention are enabled.
- A pinned PostgreSQL 17 image runs in a new isolated SISKOP container with a 2 GiB memory limit and two-vCPU ceiling.
- The same backup was restored into that container for rehearsal. Table counts/content checksums match the source snapshot, and the restricted runtime role can read the application data through destination RLS policies.
- All nine preexisting containers retained their recorded identities, start times and restart counts after provisioning and restore. No Sentryx database was queried or changed, and no preexisting service was restarted.

**The initial rehearsal was preserved. The live canonical database was promoted from a separate final write-frozen export, with all table checksums verified. Never overwrite it with a rehearsal archive.**

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

## API implementation (deployed)

- `apps/backend/src/hosting/contabo.ts`: opt-in runtime requiring the private SISKOP database, GCS storage, release ID and gateway configuration.
- `contabo-ingress.ts`: rejects direct browser traffic unless signed by a SISKOP central/tenant gateway. Scheduler and exact payment-callback routes retain their own authentication requirements.
- `scheduler-identity.ts`: verifies Google identity tokens for the configured audience and exact scheduler service account, in addition to the existing scheduler secret.
- `upload-storage.ts` and `gcs-uploads.ts`: preserve relative upload URLs using the existing private GCS bucket; local development retains filesystem storage. Both upload paths validate actual file signatures before persisting.
- `infra/central-gateway/`: fixed-upstream forwarding service with signed requests, cookie/status streaming and no automatic mutation retries. It has no database credentials.
- `cloudbuild-candidate.yaml`: manual candidate image builds only; it performs no deployment or traffic changes. Production release automation now uses the attested Contabo path; this candidate config remains build-only.

## Candidate deployment and recovery verified on 28 October 2026

- The isolated API and unprivileged HTTPS proxy run with separate limits. Public HTTPS is `https://siskop-api.inovasijayakarsa.id:18443`; PostgreSQL remains private. The nonstandard port preserves Sentryx's existing Cloudflare-only 80/443 firewall rules. Frontend addresses stay unchanged.
- Four parent DNS NS records delegate only `_acme-challenge.siskop-api` to the dedicated Google zone `siskop-api-acme`. A dedicated certificate lineage and fixed-zone DNS hooks passed a real renewal dry run. Renewal reloads only `siskop-proxy-staging`.
- The initial HTTP-challenge diagnostic added a SISKOP-only HTTP virtual host and one graceful shared Nginx reload. Existing site files were byte-identical and the master remained running. That challenge path is unused; ongoing certificates use DNS validation and the separate proxy. Do not reuse the legacy shared-host ingress installer.
- Candidate API checks proved restricted database access, transaction rollback, Firebase lookup permissions, and GCS write/read/delete using a new temporary probe object. Xendit remains in test mode. No existing business rows were modified by these probes.
- Dedicated runtime, backup and certificate identities are installed with separate permissions. Following explicit user approval, the deployer identity can read only SISKOP registry images/build results and the private release mailbox, and create receipts. Its root-only key is not mounted into the API. CI receives no VPS login or database credential.
- `siskop-backup.timer` is installed hourly at minute 12 UTC. It does nothing until `database-authoritative.json` exists, which can be written only after source fencing and final fresh-database promotion. This permits an authoritative backup before public routing opens. Encrypted rehearsal backups were uploaded and restored locally, matching all 61 tables and 110 rows. Retention is two days hourly, fourteen days daily, twenty-eight days weekly; initial recovery archives are preserved.
- A second fresh read-only source export, `pre-contabo/20261028-pre-cutover-review/`, also passed a complete local restore and has encrypted off-host copies and verification evidence. This is preparation, not a final write-frozen export.
- The new `siskop-deploy.timer` polls a private Google Storage mailbox over outbound HTTPS; no SSH/firewall change is required. `deploy_host.py` accepts only tested main builds from the exact SISKOP trigger/account and immutable SISKOP image digests. It is held until `database-authoritative.json` exists and while `deployment-hold.json` exists. The separate `traffic-switched.json` records completion of public routing, rather than conflating database authority with successful publication.
- `RELEASE_BACKEND=contabo` prepares coordinated API/central/tenant publication and OIDC scheduler readiness. The staged manifest selects Contabo; apply it only with the live trigger held during cutover. Verification-only Cloud Build `cdfc519e-5de7-48be-b60e-071d85bde421` passed all lint/typechecks, 102 backend test files (1,094 tests; 97.06% line coverage) and frontend builds. The coordinated live release also passed; see the completion record.
- `restore_candidate.py` restores only into a new allowlisted SISKOP database and compares every table checksum. `promote_candidate.py` requires documented source fencing and a newer verified final export; it preserves the old rehearsal database instead of deleting it. The final promotion completed successfully; see the completion record above.
- Fresh-destination rehearsal restored the second archive into `siskop_cutover_ae2af97f92a2`, preserving the canonical rehearsal copy and matching all 61 tables/110 rows. PDF generation also succeeded inside the bounded API container.
- External API/database uptime, 90-minute backup freshness, missing health reporter and local API/certificate/disk alert policies are configured for the user-approved `yudith.octo@gmail.com`. Policies remain disabled before cutover. The backup identity has only backup-object creation and metric writing; its OAuth scopes are limited to storage and monitoring writes, with no general cloud-platform scope. A SISKOP-only health timer will publish metrics after authority switches.

## Cutover checklist (completed; retain for audit)

1. Complete integration, capacity, migration-role and build-to-host release checks. Verify external availability and backup-freshness alerts reach the approved operator, `yudith.octo@gmail.com`.
2. Rehearse final restore/promotion on disposable SISKOP targets; preserve both source and rehearsal data. Never reset the populated rehearsal database with `restore_initial.py`.
3. Disable the old release trigger and pause both scheduled jobs, block old API invocation, drain writers, fence the source and take a new final consistent backup. Verify its encrypted off-host copy and clean restore before promotion.
4. Promote the verified fresh destination under the deployment hold, publish both forwarding routes, retarget/authenticate the existing scheduled jobs and verify application behavior.
5. Mark live authority only after routing succeeds, take an authoritative Contabo backup, enable alerts and resume the Contabo release path. Keep Supabase frozen; after new writes it is not a safe automatic rollback target.

The old Cloud SQL data remains unrecovered and outside this migration. Preserve that instance separately. The former provider is no longer an operational rollback target; current website routing uses the VPS API. The stopped historical Cloud SQL instance remains untouched.


## Final cutover checklist (operator controlled)

1. `control_plane.py prepare` snapshots only SISKOP cloud controls privately, disables its automatic main trigger and retargets its two paused jobs to the Contabo HTTPS origin. It does not block the old public API yet.
2. Merge the verified migration PR while that trigger is disabled. Manually start the exact main trigger. Its tested image/request waits in the release mailbox until the final database is authoritative and the host deployment hold is removed.
3. With the build ready to deploy, announce SISKOP maintenance, use `control_plane.py block-old-api`, drain the old API and run `source_fence.py` against the allowlisted source. It commits the role default before terminating old pooled sessions and proves writes are rejected. Never use it against another application.
4. Take a **new** source export after the fence, upload the encrypted artifacts and verify a clean local restore. Restore into a new candidate with `restore_candidate.py`, verify every table, then copy the fence/backup evidence to SISKOP's private host directory. Do not reuse a rehearsal archive as the final export.
5. `promote_candidate.py` atomically preserves the old rehearsal and renames the fresh verified database. Record `database-authoritative.json` only after this promotion and source fence are verified. The dedicated proxy remains in maintenance: only exact GET readiness routes can pass.
6. Take an authoritative off-host Contabo backup, download and independently restore it, and record `authoritative-restore-verification.json` with its real completion timestamp. Remove the deployment hold and let the attested release finish both frontend routes and OIDC scheduler checks. A scheduled POST attempted during the short maintenance interval receives 503 and follows the existing retry policy.
7. `maintenance.py open --build-id=EXACT_UUID` requires a successful coordinated build, the matching deployed API, a fresh authoritative backup, and the post-promotion restore proof. It opens only SISKOP's proxy and records the public traffic switch. Enable the prepared alerts after publishing fresh healthy metrics; re-enable automatic main releases with the Contabo override.
8. Replace the old Cloud Run business API with a credential-free forwarding configuration if any legacy provider URLs still use it. Remove old business-revision tags; retain the frozen Supabase source for observation. Never automatically route users back to that stale source after Contabo has accepted writes.

`source_fence.py` deliberately has no automatic unfreeze command. Its private evidence preserves the original database-role settings. Reopening Supabase requires first fencing Contabo and reconciling any newer records. Restoring its original role setting by itself would create two writers.

The migration role was proven with transactional DDL rollback and Prisma deploy on the separate candidate. Atomic database renames and failure rollback were also rehearsed in a disposable local PostgreSQL cluster. Three bounded read-only bursts of 100 concurrent requests all succeeded (300/300, p95 approximately 1.98 seconds on the current small dataset; Google gateway latency excluded). This is a rehearsal measurement, not a large-data production capacity guarantee.

Email delivery was accepted by Resend for the user-approved test recipient. Xendit authentication was checked with a synthetic nonexistent identifier and a test key: no existing payment record was exported and no payment was created. The balance endpoint requires permissions the checkout key does not have; do not expand that key to make an unrelated balance probe pass.


## Live operation

Normal Git pushes to `main` use the tested Contabo release path. Do not rerun preparation-only `bootstrap_host.py`, `restore_initial.py`, `configure_runtime.py` or the legacy shared-host ingress installer against the live deployment. In particular, the old Cloud Run service now contains only forwarding configuration; it is no longer a source for API runtime bootstrapping. Use the encrypted runtime recovery manifest and its explicit Secret Manager references when rebuilding.

The public maintenance gate was opened only after the successful coordinated release and authoritative off-host restore proof. Supabase stays read-only. Current database authority and traffic state are recorded in `/srv/siskop/staging/database-authoritative.json` and `traffic-switched.json`, with the deployed build in `release-state/last-deployed.json`.

## API handoff during releases

The central gateway resolves the fixed Contabo ingress using IPv4, matching its
published A record. Requests taking at least one second emit `gateway_slow_request`
with cumulative milliseconds from request handling to socket assignment, DNS,
TCP, TLS, upstream headers and response completion. Reused sockets omit connection
stages. These logs contain no URLs, headers, cookies, bodies or signing secrets.
The external uptime check's timeout and alert threshold are independent and unchanged.

The deployer starts `siskop-api-candidate` on loopback port 18082 with the same
resource limits and credentials as the regular API. It checks the published
catalog and exact release ID before switching the SISKOP proxy to its private
container IP. Nginx reloads gracefully; the deployer waits for old workers to
finish before replacing the regular API. After that API passes readiness,
traffic switches back and the candidate is stopped. No mutation requests are
retried. Two API instances temporarily share the same database; migrations must
remain compatible with the previous application version.

Before enabling this deployer on an existing host, install the matching
`deploy_host.py` and `health_host.py`, create `proxy-state/upstream.conf` containing
`set $siskop_upstream api:8080;`, and update `proxy/nginx.conf` from `proxy.conf`.
Validate and gracefully reload only `siskop-proxy-staging`. The health reporter
checks the API named in `active-api.json` during the handoff. Keep previous host
files for recovery. An interrupted handoff retains its serving candidate; inspect
`active-api.json` and recover routing before starting another release.
