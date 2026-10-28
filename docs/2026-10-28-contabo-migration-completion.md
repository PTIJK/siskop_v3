# SISKOP Contabo migration — completion record

**Status:** Live on Contabo. Customer traffic opened 28 October 2026, 16:46 WIB. The current API/database writer is Contabo; Supabase is frozen read-only.

## Current infrastructure

| Component | Current location and purpose |
| --- | --- |
| Business API | Dedicated `siskop-api-staging` container on Contabo, 1 vCPU / 1 GiB ceiling |
| PostgreSQL 17 | Dedicated `siskop-postgres-staging` cluster/database, 2 vCPU / 2 GiB ceiling; no published SQL port |
| HTTPS | Dedicated `siskop-proxy-staging`; `https://siskop-api.inovasijayakarsa.id:18443`; automatically renewed DNS-validated certificate |
| Central website | Existing Firebase Hosting site; API/uploads forward through `siskop-central-gateway` |
| Tenant/member websites | Existing Firebase App Hosting/custom domains; signed forwarding to Contabo |
| Authentication | Existing Firebase project and identities; JWT/gateway secrets preserved |
| Scheduling | Existing two Cloud Scheduler jobs and schedules; target/audience now the Contabo HTTPS origin |
| Builds/releases | Existing Git → Cloud Build → Artifact Registry; attested private mailbox deploys only SISKOP on the VPS |
| Uploads | Existing private GCS bucket `siskop-d0f8c-staging-uploads`; existing object paths preserved, seven-day bucket soft delete retained |
| Backups | Separate private bucket `siskop-d0f8c-db-backups`; client-side encrypted database archives |
| Monitoring | External API/database checks and VPS health/backup-freshness metrics; approved email notification channel |
| Legacy Google API URL | `siskop-staging-api` now forwards only; database secrets/volume and all 38 old business-revision tags removed |

The public website addresses are unchanged. The old Cloud Run API URL remains available for existing integrations, forwarding to the authoritative VPS API. All three Google web services are forwarding/static-hosting layers; business logic and database connections run on Contabo.

## Isolation and data preservation

SISKOP has its own Compose project, PostgreSQL cluster, roles/passwords, data directory, private database network, application egress network, containers, backup identity and storage destination. It does not share a database, schema, credentials or volumes with Sentryx.

The nine preexisting containers retained their IDs, start times and restart counts. All eight existing host proxy files retained their byte hashes. Sentryx's public website and API probes returned HTTP 200. No Sentryx database was queried or changed, and no preexisting application container was restarted. An earlier SISKOP-only HTTP-challenge diagnostic caused a graceful shared Nginx reload; existing site files/master remained intact. Ongoing TLS and routing use SISKOP's separate proxy.

The source was drained, its existing application role made read-only, old pooled sessions terminated, and a negative write test verified rejection. The final export was taken after that fence. A new candidate was restored and every table compared before promotion. The old rehearsal database was preserved as `siskop_rehearsal_bf4af413c33c`; the earlier separate rehearsal candidate is also retained. No source database was deleted.

## Backup and verification evidence

- Final frozen-source backup: 61 tables / 110 rows, encrypted with CMS AES-256-GCM. Uploaded, downloaded, byte-compared and restored in a clean local PostgreSQL cluster.
- Final source archive SHA-256: `bf4af413c33c34bcd9e2b4c08d37a7d33882bfea343685e12883e61aa1bf7af0`.
- Source recovery prefix: `gs://siskop-d0f8c-db-backups/pre-contabo/20261028-final/`.
- The first authoritative Contabo backup and a later hourly backup were uploaded. An authoritative off-host backup also passed a complete clean restore, matching all 61 tables / 110 rows before customer writes opened.
- Runtime recovery settings and explicit Secret Manager version references are separately encrypted as `runtime-recovery.json.cms` in the final source prefix. This file contains no plaintext secret values; it supports rebuilding after the old business-service configuration was retired.
- Hourly backups run at minute 12 UTC. Retention: hourly two days, daily fourteen days, weekly twenty-eight days. Initial recovery archives are outside automatic deletion prefixes.
- The private decryption key remains only in the operator's Git-ignored local recovery material. It was never copied to the VPS, backup bucket, Git or build context. Keep a separate secure operator-controlled copy before relying on these archives long term.

SQL backups do not contain uploaded identity-document objects; those remain in the existing private upload bucket with its own soft-delete policy.

## Release and application checks

- Merged implementation: [PR #49](https://github.com/PTIJK/siskop_v3/pull/49), commit `13e23dd6dcf5282a5130576c643c8ab1d882fdbe`.
- Successful coordinated release: `8c8ff0f6-ed02-4e70-bc4e-7d6c6cbebea3`. API migration/deployment, tenant publication, central publication and scheduler readiness all passed.
- Deployed API: `asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api@sha256:4a36317847700f37e39f31464eb09615fd4c4ba9f3f5b05b2e6f9adaae171230`.
- Full application verification: 102 backend test files, 1,094 tests passed; 97.06% line coverage. The final PR CI passed; operator/release boundary checks also passed.
- Real Cloud Build identity-token preflight authenticated to both external scheduler readiness targets without executing scheduled work.
- Runtime role read/write rollback, Firebase lookup access and GCS write/read/delete probes passed. PDF generation succeeded under the API's limits.
- Three bounded read-only bursts at concurrency 100 passed 300/300 requests; p95 about 1.98 seconds on the small rehearsal dataset, excluding Google forwarding latency. This does not establish production capacity for a larger dataset or simultaneous PDF exports.
- Xendit remains in test mode. Authentication was checked using a synthetic nonexistent identifier; no existing payment record was exported and no payment was created. A clearly labeled email test was accepted by Resend.
- Central catalog, tenant workspace, both release markers, legacy forwarding URL and Sentryx availability probes passed after the switch.

The first held release timed out before the one-time database preparation finished. It published nothing. The subsequent coordinated release completed after the protected database was ready; no stale source was opened as a second writer.

## Operations and remaining observation

The backup, certificate, deploy and health timers are separate SISKOP units. Availability, local health/certificate/disk, missing reporter and 90-minute backup-freshness alert policies are enabled for the approved operator. The API has a graceful shutdown period sufficient for the existing scheduler deadline; releases pause scheduled work and resume it only after readiness checks.

Retain the frozen Supabase project during at least the seven-day observation period. Observe a real daily run at 07:05 WIB and normal identity recovery every 15 minutes, plus continued backups and a restore drill. Do not point users back to Supabase after Contabo has accepted writes without first fencing Contabo and reconciling newer records.

The stopped historical Cloud SQL trial instance was left untouched and remains unrecovered; this migration covers the current Supabase SISKOP data. No paid Cloud SQL upgrade or new VPS was provisioned. Other Google resources were retained; unused-network/billing cleanup is a separate decision.

This remains a single-VPS deployment. Container isolation, backups and restart policies do not provide high availability.
