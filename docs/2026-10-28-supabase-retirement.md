# SISKOP Supabase retirement — 28 October 2026

**Status:** Both SISKOP Supabase projects were permanently deleted after the user confirmed the final action. The authenticated provider inventory is empty. SISKOP remains live on Contabo.

## Routing and isolation

The previous Google API URL forwards to `https://siskop-api.inovasijayakarsa.id:18443`, SISKOP's dedicated Contabo API. This is not a Supabase-to-Sentryx redirect. SISKOP and Sentryx share the existing physical VPS, but SISKOP has separate containers, PostgreSQL cluster/database, roles, directories, networks, credentials and backups. No Sentryx data or services were modified during this retirement work.

## Projects identified

| Supabase project | Reference | Data verification | Deletion |
| --- | --- | --- | --- |
| Siskop Staging v2, Singapore | `lovtfdddtafuyldnkbny` | Migrated source: 61 tables / 110 rows; final encrypted export independently restored. Zero Supabase Auth users, Storage objects or Edge Functions. | Deleted |
| Siskop Staging v1, Australia | `gnwxoxkmmywbakbvenoo` | Was paused; resumed only for read-only inventory after browser download was blocked. Zero public tables, Auth users, Storage buckets/objects, custom schemas or Edge Functions. No SISKOP records to export. | Deleted |

The earlier conversation's different project reference is absent from the authenticated project inventory; no unrelated project or account is targeted.

## Removed connections and deployment paths

- Both live Google forwarding services were checked: neither has a `DATABASE_URL` binding. The dedicated Contabo API container has no Supabase configuration.
- Removed the unused `siskop-staging-migrate` Cloud Run Job after privately preserving its configuration. Its Supabase-only Secret Manager `DATABASE_URL` version 3 was disabled and then destroyed after project deletion. Versions 1 and 2 were left unchanged; version 2 is historical Cloud SQL recovery material.
- Removed the Git-ignored local Supabase connection file.
- Removed the Cloud Run business-backend implementation. Releases default to Contabo and reject the former backend option before cloud access. Frontend publication and scheduler activation require a verified Contabo release state.
- Old direct deployment/database helper entry points deliberately fail before reading credentials or contacting a provider. Release setup no longer creates the old migration identity or grants it database-secret access. Scheduler setup targets the current Contabo origin.

Historical schema migrations and encrypted source-export provenance remain intact. They do not establish a live provider connection and must not be deleted or rewritten to remove historical provider names.

## Recovery retained outside Supabase

- Final source: `gs://siskop-d0f8c-db-backups/pre-contabo/20261028-final/`, 61 tables / 110 rows. Archive SHA-256: `bf4af413c33c34bcd9e2b4c08d37a7d33882bfea343685e12883e61aa1bf7af0`.
- An authoritative Contabo backup was independently downloaded and restored into a clean cluster, again matching all 61 tables / 110 rows before customer traffic opened.
- Ongoing backups use the private SISKOP backup bucket with hourly/daily/weekly retention. Original recovery exports are outside automatic deletion prefixes.
- The private decryption key remains under operator control outside the VPS, Git and backup bucket.
- User-requested provider retirement supersedes the PRD's proposed Supabase retention period. Recover using the current authoritative dataset; never switch back to a stale source.

The stopped historical Cloud SQL instance remains preserved and unrecovered. Firebase users, existing uploads, Google services and Sentryx remain separate from the retired provider projects.

Provider absence verified at 2026-10-28T10:36:37.462392+00:00.
