# PRD: Move the SISKOP API and database to Contabo

**Date:** 28 October 2026
**Status:** Implementation started; backup and isolated database rehearsal complete; live cutover pending
**Environment:** SISKOP staging/demo, initially approximately 100 participants
**Primary requirement:** SISKOP data belongs exclusively to SISKOP. It must never be restored into, combined with, or accessed through Sentryx databases.

## 1. Decision and desired outcome

Run the SISKOP business API and a dedicated PostgreSQL 17 instance together on the existing Contabo VPS. Give SISKOP its own Compose project, API and database containers, PostgreSQL cluster, roles, credentials, filesystem directories, Docker networks, backup destination, and operating procedures. Keep Firebase Authentication, frontend Hosting/App Hosting, Cloud Build, Artifact Registry, Cloud Scheduler, Secret Manager, Google Cloud Storage, and existing payment/email integrations.

The API connects to PostgreSQL over a private SISKOP network on the same host. PostgreSQL has no published host port or public listener. Cloud NAT, reserved Google outbound IP addresses, and VPC connectivity are not required for this database connection. Migration commands also run on the VPS inside the SISKOP network.

Retain the existing tenant gateway and add a small central forwarding service on Cloud Run to preserve Firebase Hosting's same-origin `/api` and `/uploads` routes and login cookies. These gateways forward HTTPS requests to Contabo; they do not run business logic, migrations, or database connections. This design reduces Google's backend workload but does not eliminate all Cloud Run charges or cross-cloud HTTPS traffic.

Success means existing SISKOP accounts and application records work after the move, Sentryx remains unaffected, builds deploy only SISKOP, scheduled work reaches the new API, and a tested backup can recover SISKOP independently.

This is application and database isolation on shared hardware. It is not isolation from the VPS root administrator, Docker administrators, host compromise, disk failure, or host outage. If that stronger boundary becomes mandatory, use a separate VPS or equivalent separate host.

## 2. Evidence and assumptions

The following measurements came from the preceding read-only audit on 27 October 2026. They are planning inputs, not a new live audit or a capacity guarantee. Recheck before implementation.

| Component | Observed state | Planning implication |
|---|---|---|
| Contabo VPS | 6 vCPU, approximately 12 GiB RAM | Existing host is a plausible demo candidate |
| Available memory | Approximately 8.4 GiB at inspection; recorded minimum approximately 8.16 GiB | Room for bounded SISKOP API and database allocations; validate combined load |
| CPU history | Approximately 4.45% p95 busy; 11.28% maximum sampled interval | Low historical utilization; ten-minute samples can miss bursts |
| Root disk | Approximately 73 GiB available | Capacity exists, but database/WAL/backup growth needs limits and alerts |
| Sentryx workloads | Two PostgreSQL 16/TimescaleDB containers, WordPress/MariaDB, checkers, and host processes | SISKOP must use a separate PostgreSQL cluster; do not reuse either TimescaleDB container |
| Existing DB memory settings | Approximately 2.92 GiB shared buffers per PostgreSQL container; no container memory caps observed | Reassess whole-host worst-case memory, not just idle usage |
| Supabase source | Singapore project `lovtfdddtafuyldnkbny`, PostgreSQL 17, Free plan | Match PostgreSQL major version on destination |
| SISKOP data | Approximately 14.6 MB; two users, three tenants, no members or journal entries at inspection | Export actual data afresh; current tiny dataset is insufficient for capacity testing |
| API | Cloud Run Jakarta, 1 vCPU/1 GiB, max one instance, concurrency 20, Prisma pool limit three | Current baseline only; replace Cloud Run execution with a bounded VPS API container |
| Authentication | Firebase Auth; application roles and tenant memberships in PostgreSQL | Keep Firebase identities and database identity mappings intact |

The VPS location, gateway-to-VPS HTTPS latency, sustainable combined API/database capacity, and a complete Sentryx backup restore were not verified. Existing Sentryx backup tooling is not proof that SISKOP is backed up.

The old stopped Cloud SQL instance `siskop-staging` has unrecovered historical data. This project migrates the current Supabase dataset only. It neither recovers nor replaces that historical dataset. Preserve the old instance until a separate recovery decision is made; never silently merge recovered records into the new database.

## 3. Scope

### Included

- Dedicated SISKOP API and PostgreSQL deployments, private database access, HTTPS ingress, and local migration execution.
- Central forwarding service, tenant gateway routing, external Google credentials, and preservation of upload and scheduler behavior.
- Schema, data, IDs, constraints, indexes, sequences, functions, triggers, and Prisma migration history required by SISKOP.
- Explicit role and RLS compatibility with ordinary PostgreSQL.
- Separate credentials, encrypted off-host backups, monitoring, restore testing, and maintenance ownership.
- Deployment updates, a rehearsed write freeze, validation, cutover, rollback, and observation.
- Representative demo testing with 10, 25, 50, and 100 active virtual users.

### Excluded

- Changes to Sentryx data, database schemas, credentials, containers, or backup destinations.
- Changing providers for authentication, frontend hosting, uploads, builds, registry, secrets, scheduling, email, or payment processing. Their endpoints/configuration may change as required.
- Replacing Cloud Scheduler with VPS cron, or replacing Cloud Build with builds on the shared VPS.
- Supabase Auth/Storage/Realtime migration unless dependency discovery proves SISKOP uses them.
- Recovery or merging of old Cloud SQL records.
- High availability, automatic cross-host failover, and a zero-downtime promise.
- Test fixtures, demo seeds, or bulk generated users in the migrated staging database.

## 4. Isolation requirements

All names below are proposed and must be checked for collisions before creation.

| Boundary | SISKOP requirement | Prohibited shortcut |
|---|---|---|
| Compose project | `siskop-staging` with a dedicated manifest | Adding SISKOP services to Sentryx's Compose deployment |
| API | Dedicated `siskop-api-staging` container from an immutable SISKOP image digest | Reusing Sentryx processes, PM2 applications, runtime secrets or deployment hooks |
| PostgreSQL instance | Dedicated container `siskop-postgres-staging`, pinned PostgreSQL 17 image digest | Creating only another schema/database inside Sentryx TimescaleDB |
| Database | `siskop_staging` in the SISKOP cluster | Restoring into `sentryxmonitor`, its staging DB, or MariaDB |
| Persistent data | Dedicated `/srv/siskop/staging/` tree with separate PostgreSQL data, configuration and bounded temporary directories; verified ownership and mounts | Mounting a Sentryx volume or data directory |
| Network | Private SISKOP DB network with no published DB port; separate API egress/ingress network | Joining Sentryx networks, host networking, or broad database exposure |
| Roles | SISKOP-only owner, migration, runtime, and backup roles | Reusing Sentryx or Supabase administrator credentials |
| Secrets | SISKOP-only Secret Manager resources and restricted runtime secret delivery; separate database runtime/migration credentials | Shared passwords, plaintext repository secrets, or automatic `latest` binding |
| Backups | Dedicated off-host bucket with SISKOP-only identity and encryption access | Sentryx backup prefix/credentials or local-only backups |
| Operations | Dedicated deploy identity, allowlisted release wrapper, scripts, alerts, logs, and restore targets | Root SSH for CI, Docker-group membership for deploy users, global Docker cleanup, or arbitrary container selection |
| HTTPS ingress | SISKOP-specific hostname and narrowly scoped proxy configuration | Replacing Sentryx virtual hosts, certificates or upstreams |

Provisioning, backup, restore, and migration scripts must fail closed unless the expected host identity, Compose project, container, database name, and SISKOP-only deployment marker match. Never treat a matching port alone as target identification. Destructive rehearsal cleanup must require the exact disposable rehearsal target and refuse the staging target.

Do not mount the Docker socket into SISKOP containers. Restrict directory ownership to the intended service account/container UID. Use non-privileged containers and avoid unnecessary host capabilities. Docker/network administrators still retain host-wide powers.

## 5. Target architecture and retained services

```text
Central Firebase Hosting --> small Cloud Run forwarding service --+
Tenant Firebase App Hosting gateway ------------------------------+--> HTTPS
Cloud Scheduler --------------------------------------------------+      |
Xendit callbacks -------------------------------------------------+      v
                                                           Contabo SISKOP API
                                                                  |
                                                    private SISKOP-only network
                                                                  |
                                                        SISKOP PostgreSQL 17
                                                                  |
                                                     encrypted off-host backups

Cloud Build --> Artifact Registry --> restricted VPS release command
                                           |--> local one-shot migration
                                           |--> SISKOP API deployment

VPS API --> Firebase Auth / GCS uploads / Resend / Xendit
Sentryx runs separately; no shared application data or credentials.
```

### 5.1 Private database and isolated API

PostgreSQL attaches only to the private SISKOP database network. The API attaches to that network and a SISKOP network that permits required outbound HTTPS. A one-shot migration container attaches to the database network only for the release. Do not join Sentryx networks, publish PostgreSQL ports, or grant the API the migration credential.

Host ingress is HTTPS on a dedicated SISKOP hostname, chosen after checking DNS ownership and collisions. Bind the SISKOP API/proxy upstream to an unused loopback port only. The host already serves other applications on ports 80/443: add a narrowly scoped SISKOP virtual host, validate the complete configuration, and gracefully reload only after preserving Sentryx routing. Do not replace the host proxy configuration or restart Sentryx services. This shared ingress is an explicit host-level dependency, not shared application data.

Use valid TLS certificates, automatic renewal and expiry alerts. Gateways verify the upstream certificate and hostname. Test invalid certificates, direct container-port access, unrelated-container access to PostgreSQL, and external database probes. Inspect Docker forwarding rules as well as host firewall rules. Administrative database work uses a controlled SISKOP container command; no permanent external SQL endpoint is introduced.

### 5.2 Preserve central and tenant browser sessions

Current `firebase.json` rewrites `/api` and `/uploads` to a pinned Cloud Run service. The frontend uses HttpOnly cookies for login refresh and onboarding recovery. Firebase Hosting does not turn an arbitrary external URL into an equivalent Cloud Run rewrite. Preserve the existing browser origins through a small proposed service `siskop-central-gateway`, then change the Hosting rewrite to that service. Keep `siskop-tenants` on App Hosting and change its verified upstream to Contabo. [Firebase Hosting configuration](https://firebase.google.com/docs/hosting/full-config).

The central gateway has no database credential, Prisma migrations, scheduler implementation, or business handlers. Pin its release image/configuration. Allow only the configured SISKOP HTTPS upstream: no user-selected destinations or open proxy behavior. Preserve request method/path/query, bounded streaming uploads, response status, cookies, redirects, and cache controls. Never log authorization headers, cookies or uploaded identity documents. Never automatically retry non-idempotent writes.

Preserve the tenant gateway's signed host assertion. Strip untrusted forwarded identity headers, establish an explicit central-host assertion, and validate gateway identity at the API. Do not trust arbitrary `Host`/`X-Forwarded-Host` values as tenant identity. Distinguish browser-gateway routes from independently authenticated scheduler and webhook routes. Configure Express proxy trust for the actual proxy chain rather than accepting all forwarded headers.

Acceptance includes login/refresh/logout, onboarding cookies, tenant handoff, direct-link navigation and uploads on desktop and mobile browsers. Avoid changing cookie domains/SameSite settings merely to bypass a failed routing design. Cross-origin browser-to-VPS API access is not the baseline for this migration.

### 5.3 Keep uploads in Google Cloud Storage

The current API writes files under `STORAGE_PATH` and Cloud Run mounts `siskop-d0f8c-staging-uploads` there. That managed mount is not automatically available on Contabo. Keep the bucket and existing object keys; do not silently replace it with the VPS filesystem.

Implement a GCS storage adapter for upload/write/read operations and stream existing `/uploads/...` paths through the API, preserving tenant authorization, content validation, size limits and cache policy. Inventory all filesystem upload paths, including public member registration, before conversion. Temporary processing files must be bounded and cleaned up; an upload is successful only after durable storage succeeds. Validate existing and new files, retry behavior, deletion if supported, and failure handling. The bucket must not become public as a shortcut. The PostgreSQL backup does not back up uploaded objects; retain and document the bucket's own recovery policy.

### 5.4 Keep Google identities, secrets and integrations

The Contabo API has no Cloud Run metadata identity. Configure a SISKOP-specific Google workload identity and the minimum permissions for the Firebase Admin operations, GCS bucket and secrets it actually uses. Prefer short-lived credentials through a proven federation/bootstrap design. Do not assume federation works without a trusted identity provider. If a service-account key is necessary for the demo, document its storage, rotation, revocation and recovery; keep it in a restricted secret file, never in Git, images, build output or Sentryx directories.

Retain Secret Manager as the source of truth, with explicit versions and a controlled bootstrap path to fetch only necessary runtime secrets. Keep runtime, migration, registry-pull and backup privileges separate. Prove unattended restart and credential renewal, including when the operator's laptop is offline. Preserve JWT keys, Firebase project identity, gateway authentication and intended Xendit test mode; do not generate replacement application identities during the move.

Keep Resend, Xendit and Google Cloud Storage. Test their outbound HTTPS calls from Contabo, including email links, checkout return URLs and webhook authentication. Any stable old callback URL must forward safely or be updated with the provider before cutover; retries to old URLs must not write to the old database.

### 5.5 Keep Cloud Scheduler; verify identity at the VPS

Keep the two existing jobs and schedules, but retarget their HTTPS requests to the SISKOP VPS API. On an external target, the receiver must verify the Google OIDC token; Cloud Run IAM no longer performs that check. Validate signature, issuer, expiry, exact audience and expected scheduler service-account identity, plus the existing application scheduler secret. Current route code checks the shared secret only, so receiver-side OIDC verification is implementation work. [Cloud Scheduler authentication](https://docs.cloud.google.com/scheduler/docs/http-target-auth).

Use the appropriate new audience consistently in job configuration and verification. Test expired tokens, wrong audiences, another service account and missing application secrets. Preserve idempotency, retry semantics, execution locks and readiness probes. Set a real release identifier in readiness responses instead of relying on Cloud Run's automatic `K_REVISION`. Do not introduce a VPS cron task that duplicates Cloud Scheduler's business jobs.

## 6. Initial capacity budget

These are starting settings for rehearsal, not a claim that 100 simultaneous users will pass.

| Setting | Initial proposal |
|---|---|
| API CPU / RAM limit | Start at one vCPU and 1 GiB; enforce and measure |
| Migration container | Short-lived, start at one vCPU / 512 MiB; include it in peak-memory calculations |
| PostgreSQL CPU limit | Two vCPUs maximum |
| PostgreSQL memory limit | 2 GiB enforced container limit; do not allocate all free host memory |
| Shared buffers | Start at 512 MiB and measure within the container budget |
| Work memory | Start conservatively at 4 MiB; it can be allocated per operation, not just per connection |
| Connections | Start at 40 total, with administrative headroom |
| API connection pool | Retain three per process initially; tune only from measured queueing |
| Disk planning budget | 20 GiB for SISKOP data, WAL, logs, and temporary work combined; alert well before exhaustion |
| Temporary files/logs | Bound database temporary-file usage and configure log rotation |
| Restart behavior | Restart on failure with health checks and alerts; no automatic major upgrades |

A directory on the shared root disk is not a 20 GiB reservation or quota. Choose and document a supported filesystem quota or dedicated filesystem if a hard storage boundary is required. Monitor both SISKOP usage and total host free space. WAL can grow during failures; retention settings are not substitutes for monitoring.

Budget approximately 3 GiB for the steady-state API/database container limits, plus host proxy, backups and operating-system overhead. Reserve additional headroom for migration and temporary candidate API containers; CPU limits are ceilings, not dedicated reservations. Do not build application images on the shared VPS.

Calculate connection capacity across all live API containers, migration/backup workers, and administrative sessions. A rollout can overlap containers. One hundred users does not require one hundred database connections.

Do not retune or restart Sentryx as a side effect. If baseline review finds unsafe combined memory commitments, make that a prerequisite maintenance task with a separate impact assessment.

## 7. Schema, permissions, and data compatibility

1. Inventory the source's application schemas and objects, extensions, large objects, policies, grants, triggers, functions, and dependencies outside `public`. Record the source PostgreSQL version and migration checksums.
2. Define an explicit export manifest of SISKOP objects. Include `_prisma_migrations`. Do not export Supabase platform schemas or global roles wholesale. Schema-only selection does not automatically capture all dependencies; explicitly include required extensions and large objects if present.
3. Use a logical custom-format dump through a supported direct or session-pooler connection, with a compatible PostgreSQL 17 client. Do not use transaction pooling for this operation. Inspect the dump object list and schema before restoring. [PostgreSQL dump documentation](https://www.postgresql.org/docs/17/app-pgdump.html), [Supabase connection guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
4. Restore into an empty, positively identified SISKOP database. Map ownership to the SISKOP owner and rebuild grants explicitly rather than importing Supabase roles/ACLs. Abort on restore errors; do not waive missing functions or failed constraints.
5. Preserve IDs, Firebase UID links, tenant mappings, migration history, financial precision, timestamps, sequences, uniqueness, and trigger behavior. Do not rerun seeds or manufacture replacement accounts.
6. Run migration status checks first. Apply only reviewed pending Prisma migrations, using the dedicated migration role. Never run `migrate reset`, `db push`, or development migration commands against staging.

### Runtime role and RLS

Use a non-login schema owner, a restricted migration login permitted to manage SISKOP objects, and a separate runtime login with only required application privileges. Runtime must not be superuser, create roles/databases, own the schema, or hold `BYPASSRLS`. Backup access must be sufficient to capture every intended row and independently validated.

The existing `20261011230000_protect_supabase_backend_tables` migration conditionally enables RLS when Supabase roles exist. Existing source tables already have RLS enabled. A restored non-owner runtime role can therefore see no rows even after ordinary grants. Do not assume the migration's conditional block makes a restored database portable. [PostgreSQL RLS behavior](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

Create reviewed destination policies explicitly for the trusted backend role where required, together with grants and default privileges for future objects. SISKOP currently performs user/tenant authorization in its backend; a backend-wide database policy does not itself enforce tenant isolation. Retain and test that application authorization. Do not create public/anonymous access policies or fake Supabase roles to suppress errors. Record every environment-specific policy/ownership change in versioned provisioning SQL and test it on a clean restore.

## 8. Deployment integration

Keep the existing Git-to-Cloud-Build workflow and Artifact Registry. Change its deployment stage to release the API on Contabo and run Prisma migrations locally on the SISKOP private network. The old Cloud Run business API and migration job become rollback-only resources during observation, then are retired separately. Do not leave an automatic path that redeploys business logic against Supabase on the next merge.

| File/component | Required implementation |
|---|---|
| `infra/firebase/cloudbuild-release.yaml` | Keep build/tests and isolated CI PostgreSQL; publish immutable images; invoke a restricted SISKOP VPS deployment workflow |
| `infra/firebase/release.py` | Preserve release locking, image retention and coordinated frontend publication; replace business API/job deployment with VPS migration/deployment/readiness; replace hard-coded `.run.app` candidate assumptions |
| `infra/firebase/deploy-api.sh` | Retire from the normal business API path; retain documented rollback use only or replace with a clearly separate gateway deploy script |
| `infra/firebase/setup-release.sh` | Scope build/deploy/gateway identities and secret access; remove database access from gateway identities |
| `firebase.json` | Rewrite central API/uploads to the new thin forwarding service, preserving frontend Hosting |
| `apphosting.yaml`, `infra/tenant-web/` | Preserve tenant frontend/gateway; route signed requests to the verified VPS HTTPS upstream |
| `apps/backend/src/` | GCS upload adapter, external Google credentials, scheduler OIDC verification, proxy trust and release/readiness identification |
| `infra/firebase/setup-scheduler.mjs` and scheduler release checks | Update target/audience and verification while retaining schedules and maintenance hold |
| `infra/firebase/tests/` and backend tests | Verify release failure gates, gateway behavior, secret isolation, storage adapter, scheduler tokens and cross-tenant access |
| Proposed `infra/contabo/siskop/` | Dedicated Compose manifest, bounded API/DB configuration, role/policy SQL, deployment wrapper and guarded backup/restore scripts |
| Infrastructure documentation | Record the new architecture, resource owners, credentials, routing, recovery and retirement procedure |

### Restricted deployment transport

Choose and prove a non-interactive authenticated path from Cloud Build to a dedicated SISKOP deploy account before cutover. Baseline: pinned-host-key SSH with a forced command that accepts only validated SISKOP release metadata and invokes a root-owned, narrowly allowlisted release wrapper. Do not grant CI root SSH, a shell with unrestricted sudo, Docker-group membership, arbitrary mounts, or general container execution. A broad Docker command is effectively host administration.

Cloud Build workers may have dynamic source addresses. Do not rely on an observed build IP for allowlisting. Use a restricted SSH service with strong key authentication, no forwarding/PTY, rate limiting and audited forced commands, or a tested private/pull-based release mechanism if policy requires it. Neither approach needs a public database port. Keep deployment authorization material separate from runtime credentials. Prove this path without interactive prompts or a laptop tunnel; fail closed if unavailable.

### Release sequence

1. Build/test once in Cloud Build; publish the API image by immutable digest and record commit/build ID.
2. Acquire the existing release lock plus a VPS-local SISKOP lock; reject stale or overlapping releases.
3. Invoke the restricted wrapper. Validate host/project/container identifiers, allowlisted image repository/digest and expected configuration version. Pull with a registry-read-only identity.
4. Run one migration container from the same image with the separate migration credential. Stop on failure; never run seeds or resets. Use backward-compatible schema changes for routine releases; destructive changes require a separate maintenance/data-recovery plan.
5. Start the API candidate with runtime-only credentials and bounded resources. Check database readiness and the authenticated release identity; a generic HTTP health response is insufficient.
6. Switch the SISKOP upstream to the validated candidate, then coordinate gateway/Hosting releases if needed. Keep previous compatible image/configuration for rollback and drain old requests.
7. Resume schedulers only after the explicit maintenance hold is released and routing/readiness checks pass. Retain current and rollback images; clean up only SISKOP-owned candidates.

Use distinct proposed Secret Manager resources `SISKOP_STAGING_DB_RUNTIME_URL` and `SISKOP_STAGING_DB_MIGRATION_URL`, with explicit numeric versions. Bind each to `DATABASE_URL` only in its intended container. Mount or inject secrets through a protected mechanism; never expose resolved values in release logs or generated artifacts. Gateways receive no DB credentials. Preserve unrelated runtime settings and integration credentials.

Daily processing remains at 07:05 WIB and identity reconciliation every 15 minutes. Business scheduling remains owned by Cloud Scheduler.

## 9. Execution phases and gates

### Phase A — Baseline and design completion

- Recheck VPS resources, running services, ports, disk layout, existing firewall rules, and current SISKOP source identity.
- Record Sentryx health, restart counts, latency/error baseline and resource usage without reading business records.
- Inventory SISKOP dependencies and all writers, including schedulers, webhooks, manual tools and old API revisions.
- Verify VPS location and measure end-to-end browser/gateway-to-VPS response time; price retained gateway, storage and traffic costs. Prove CI deployment transport and external Google credential bootstrap.
- Name a migration operator, application verifier, and ongoing database/backup owner before scheduling cutover.
- Record the actual source row counts, migration checksums, image digest, routing configuration and secret versions in a private evidence manifest.

**Exit:** Network design, costs, isolation boundaries, maintenance controls, and ownership are concrete and reviewed.

### Phase B — Provision the isolated destination

- Create only SISKOP directories, networks, API/database containers, database roles, certificates and backup resources. Add the scoped SISKOP HTTPS virtual host without altering Sentryx routing.
- Provision gateway-only identities, VPS runtime credentials, restricted deployment access, GCS integration and scheduler-token verification.
- Set resource limits, target guardrails, access restrictions, logs and alerts.
- Prove SISKOP credentials cannot authenticate to Sentryx DBs and Sentryx application credentials are not valid in SISKOP. Do not expose or rotate Sentryx credentials for the test; use controlled connection checks where available and inspect authentication boundaries otherwise.
- Prove disallowed network paths and invalid certificates fail.
- Exercise API/database restart, credential renewal, image pull, certificate renewal and failed deployment recovery on SISKOP only. Verify Sentryx endpoints before and after proxy reload.

**Exit:** Empty destination passes isolation, connectivity and operational checks; Sentryx baseline is unchanged.

### Phase C — Rehearsal and capacity test

- Take an encrypted source snapshot and restore it to an explicitly disposable SISKOP rehearsal database/container with its own data path.
- Disable real email/payment/scheduler side effects in the rehearsal application. Use Xendit test credentials and controlled Firebase test identities; do not alter existing accounts.
- Validate schema/data parity and permissions using the real runtime role, not only the owner.
- Restore an off-host backup into a second disposable SISKOP target to prove recoverability.
- Add synthetic data only to rehearsal. Start with approximately 100 staff identities across ten tenants, 1,500 synthetic member records total, and representative financial/reporting history. Confirm these volumes match the intended demo; increase them if the actual demo is larger.
- Run realistic mixed workflows at 10/25/50/100 active virtual users, with recorded think times and request rates. Include a simultaneous login burst, writes, reporting, tenant switching and scheduler overlap. Do not equate virtual users with requests per second.
- Measure client/API latency, request errors, Prisma queueing, DB queries/locks, CPU/RAM/disk and Sentryx health. Stop on host pressure or Sentryx regression.
- Test central and tenant cookies, existing/new uploads, Firebase provisioning, email, test checkout, callback retries and real Cloud Scheduler delivery to the rehearsal target without business side effects.
- Repeat the cutover procedure on rehearsal and record each step's duration.

**Exit:** Isolation, parity, restore and performance gates pass; no synthetic fixtures are in the final source/export.

### Phase D — Controlled cutover

Use a planned maintenance window. Budget an initial 30–60 minute window, then replace this estimate with rehearsal measurements. This is not a zero-downtime migration.

1. Freeze deployments and pause both scheduler jobs. Verify release automation cannot re-enable them during the window.
2. Close all application write paths, including central/tenant/direct/tagged API URLs, registration and webhooks. Drain in-flight requests and transactions. Record how external events will be retried or reconciled; do not acknowledge payment events that have not been durably handled.
3. Fence old source writers using a rehearsed reversible database or credential control. A frontend maintenance page alone is insufficient. Verify that attempts through old revisions cannot write to Supabase.
4. Take the final consistent SISKOP-only dump, record its checksum and row-count manifest, and store an encrypted off-host copy. A prior rehearsal dump is not the final migration input.
5. Restore into the empty final SISKOP target, apply ownership/policy provisioning, and validate schema/data parity. Ensure no rehearsal fixtures or seeds are included.
6. Run the local one-shot migration container, start the VPS API candidate, and verify DB/GCS/Firebase readiness with pinned secrets. Perform read-only smoke checks while maintenance remains active.
7. Publish the central forwarding service/Hosting rewrite, update the tenant upstream, scheduler target/audience and callback routing. Verify each reaches the same VPS release. Multi-service changes are not atomic: keep maintenance active throughout partial publication and retain the source write fence on old direct/tagged API URLs. Do not allow both databases to accept writes.
8. Make the go/no-go decision before reopening writes. On failure at this point, use the pre-write rollback below.
9. Open application traffic. Run a small, explicitly identified smoke transaction in the designated smoke tenant, then resume schedulers and reconcile deferred external events exactly once.
10. Observe health, log a durable cutover timestamp, and retain the frozen source and migration evidence.

**Exit:** One authoritative writable database, correct routing, functioning login/workflows, and no unexpected Sentryx impact.

### Phase E — Observation and retirement

- Observe closely during the demo and at least seven days after cutover, including a daily scheduler run and a complete backup/restore cycle.
- Keep source Supabase data unchanged for a proposed 14-day rollback retention period, subject to actual project availability and retention policy. Retain the encrypted final export independently of Supabase availability.
- Update the infrastructure inventory and operational runbook.
- Retire Supabase access, the old business API revisions and Cloud Run migration job only after successful validation and an explicit retirement decision. Keep the central forwarding service, tenant gateway and all retained supporting services. Retain old Cloud SQL separately pending historical-data recovery.

## 10. Data validation and acceptance tests

| Requirement | Passing evidence |
|---|---|
| Correct source and destination | Verified source project and SISKOP deployment marker/database; no Sentryx endpoints in manifests |
| Data completeness | Exact per-table counts at frozen snapshot; deterministic ordered content checksums for application tables; documented exclusions only for provider-managed objects |
| Financial correctness | Exact numeric totals and ledger balances by tenant/account/period where records exist; no duplicate postings |
| Schema fidelity | Expected constraints, indexes, enums, functions, triggers, sequence values and Prisma migration checksums verified |
| Existing login | Existing Firebase identity works with preserved user/tenant/role records; no password resets introduced |
| Tenant isolation | Negative tests for cross-tenant reads/writes and role escalation; backend-wide DB access does not substitute for these tests |
| Sentryx separation | Separate API/cluster/mounts/networks/roles/bucket/deploy identity; no Sentryx objects in SISKOP; no Sentryx service/data changes; scoped host proxy addition preserves Sentryx behavior |
| Deployment | Migration failure stops release; runtime/migration containers use separate pinned credentials; CI cannot target Sentryx; next normal deployment retains Contabo destination |
| Database exposure | No host-published PostgreSQL port; API and migration container connect only within SISKOP network |
| Retained services | Same-origin cookies work; existing/new uploads persist in GCS; Firebase Admin, email, test payments and authenticated scheduler delivery pass from VPS |
| Gateway isolation | Gateways contain no database credential or business handlers and cannot proxy to arbitrary upstreams |
| Routing | Central site, tenant site, direct API and schedulers agree on the authoritative database |
| Recovery | Independent off-host backup restored successfully and validated within target recovery time |

Store checksum results and aggregate validation privately; avoid committing user data or printing rows/credentials in CI logs. Compare data before application smoke writes, or explicitly account for those writes afterward.

### Proposed demo performance gates

These are acceptance targets, not measured results or production SLAs. Run both the Supabase baseline and candidate with the same dataset and workload where feasible.

- Normal API operations: p95 under two seconds; reports: p95 under ten seconds.
- Unexpected request failure rate below 1%; zero duplicate financial postings or lost acknowledged writes.
- Sustain the 100-active-user stage for at least 15 minutes after warm-up, then a representative 60-minute soak at expected demo activity.
- No OOM/restarts, persistent lock pileups, or exhausted database connections; keep at least 20% DB connection headroom.
- Maintain at least 2 GiB host available memory and 20 GiB host disk free; investigate sustained host CPU over 70% or database memory over 80% of its limit.
- No new Sentryx errors/restarts; investigate a repeatable Sentryx latency increase above 10% under comparable load. Do not infer regression from a few noisy samples.

If gates fail, identify API concurrency, database query plans, pool queueing, network latency, or VPS contention before buying more capacity. Retest only the affected scenario after a targeted change.

## 11. Backup and recovery requirements

For this demo, propose a steady-state **RPO of at most one hour** (up to one hour of data may be lost in a host disaster) and **RTO of at most two hours**, both to be proven in rehearsal. Cutover itself targets no lost acknowledged writes through the write freeze and parity checks. Stronger financial-production recovery requirements require a separate decision.

- Hourly encrypted logical backups to a dedicated off-host SISKOP bucket; schedule at a measured low-impact offset from Sentryx jobs.
- Retain 48 hourly, 14 daily, and four weekly copies, subject to measured storage cost and applicable retention policy.
- Back up role/policy definitions, API release manifest, gateway/upstream configuration and SISKOP proxy/Compose definitions separately, without plaintext passwords. Securely retain the key material and bootstrap information needed to restore the API and database on a replacement host.
- Restore drills must recover API-to-database operation, external Google credentials, existing GCS objects and scheduler delivery, not just PostgreSQL rows.
- Alert when no successful off-host backup has completed within 90 minutes, on failed upload/checksum, or on inadequate disk space.
- Run a restore drill before cutover, after material backup/configuration changes, and monthly. Use a separate SISKOP restore destination with no external side effects.
- A dump file's existence or a successful upload does not prove recoverability. Verify tables, checksums, permissions and application access after restore.
- If hourly logical dumps become too costly or slow, design SISKOP-only WAL archiving and point-in-time recovery. Never join Sentryx's WAL archive namespace.

## 12. Rollback and failure handling

### Before any writes are accepted on Contabo

Keep maintenance active. Restore the original central Firebase rewrite, tenant upstream, scheduler target/audience, callback routing and recorded Cloud Run/Supabase release. Stop/fence the Contabo candidate, reverse the source write fence, verify source access and GCS behavior, then reopen traffic and schedulers. Restore original pinned secret/configuration references where needed. Preserve failed destination evidence for diagnosis; do not roll back shared host proxy configuration over unrelated Sentryx changes.

### After Contabo has accepted writes

Supabase is now stale. Switching only a connection string would lose new records or create divergent histories and is prohibited.

Close writers and schedulers again. Prefer repairing Contabo if recoverable. Otherwise, export the complete current authoritative SISKOP dataset and rehearse a validated reverse restore to an isolated compatible destination before repointing all traffic. Confirm Supabase restore privileges and schema compatibility during rehearsal if it is intended as that destination. Reconcile external events and financial records; do not merge two live databases or overwrite Supabase without a verified plan and recovery copy.

For an API-only defect with a compatible database schema, roll back the SISKOP API image/configuration on the VPS while keeping the authoritative Contabo database. This does not require a database rollback. Do not reconnect the old Cloud Run API to the VPS by opening a database port as an emergency shortcut.

If the VPS is unavailable, restore the API and most recent verified off-host database backup on a replacement host. Report the actual recovery point and any potential gap; do not claim the frozen Supabase copy contains later writes. Host-wide failure can affect Sentryx and SISKOP together.

## 13. Cost and responsibility

Reusing the VPS can avoid purchasing another server, subject to capacity verification. API-to-database traffic stays local, eliminating the proposed Google NAT/static-egress design for database access. This is not a zero-cost or Google-free architecture: gateways, builds, storage, backups and external HTTPS traffic remain.

Record a priced monthly estimate before implementation:

| Cost item | Treatment |
|---|---|
| Existing Contabo subscription | Existing shared expense; verify no resize/storage purchase is necessary |
| Cloud NAT, reserved Google address, database VPC networking | Not required for the selected design; do not provision them for database access |
| Cross-cloud HTTPS traffic | Gateways forward API/uploads; VPS accesses GCS/Auth/integrations; builds transfer images. Estimate by direction and provider allowance. No per-query cross-cloud database traffic |
| Backup storage, requests and retention | New dedicated SISKOP destination; estimate from backup size and retention schedule |
| Cloud Run | Retain a small central forwarding service and the existing tenant gateway; retire the old business API/job after observation. Proxy compute and transfer still cost money |
| Cloud Build / Artifact Registry / Scheduler / Firebase / GCS / Secret Manager | Retain; include current usage, VPS image pulls, object transfer and any new secret access |
| Operations | Named owner for security updates, certificates, backups, recovery, capacity and incident response |

Use measured costs and workload to decide whether the move's control and capacity benefits justify any increase over Supabase Free. Do not count an avoided hypothetical paid subscription as current savings.

## 14. Implementation deliverables and completion checklist

- [ ] SISKOP-only API/database infrastructure manifest and combined resource limits, with reviewed destination identifiers.
- [ ] Private, unpublished PostgreSQL network and HTTPS API ingress; no database NAT/static-IP resources.
- [ ] Central forwarding service and tenant upstream preserve sessions, signed tenant context and upload routes.
- [ ] GCS adapter, external Firebase/Google credentials and scheduler OIDC validation verified.
- [ ] Restricted CI-to-VPS deployment and local migration execution tested without access to Sentryx.
- [ ] Versioned owner/runtime/migration/backup permissions and RLS compatibility provisioning.
- [ ] Guarded export, restore, backup and parity-validation scripts that reject Sentryx targets.
- [ ] Updated release scripts, tests, maintenance hold and pinned secret bindings.
- [ ] Source inventory and encrypted final export with checksum manifest.
- [ ] Rehearsal report covering isolation, real workflows, load and Sentryx impact.
- [ ] Successful off-host restore drill and measured recovery time.
- [ ] Cutover runbook with exact routing controls, writer fencing and external-event reconciliation.
- [ ] Pre-write and post-write rollback procedures rehearsed and understood.
- [ ] Named operational owner, alerts, patch schedule and backup retention policy.
- [ ] Observation completed; source retirement handled as a separate explicit action.

**Cutover remains gated on secure connectivity, source fencing, destination isolation, restore testing and application validation. Implementation has started: a verified encrypted backup is stored off the VPS and restored into an isolated Contabo rehearsal database. Live traffic remains on Supabase. See [implementation status and operator notes](../infra/contabo/siskop/README.md) for completed work and outstanding steps.**
