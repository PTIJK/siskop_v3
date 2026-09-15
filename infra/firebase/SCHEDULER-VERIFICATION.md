# Scheduler verification — 2026-09-15

PR #17 (`fixes/scheduler`) includes main through merge `479523a` and schedules
both daily financial calculations and Firebase provisioning recovery.

## Local checks

- 501 backend tests passed; 95.35% line coverage. Tests used a newly initialized
  PostgreSQL 18 instance on loopback with database `siskop_scheduler_test`.
  Cloud SQL and real Firebase accounts were not used by the tests.
- The forced-concurrency regression produced six interest credits against the
  original implementation, then one credit with the row-lock fix.
- A journal failure rolls back the affected credit and timestamp. Retrying posts
  the failed account while skipping accounts already credited that day.
- HTTP tests cover authentication, read-only readiness, disabled recovery,
  provider failures, and HTTP 503 for partial daily failures.
- 5 setup tests and 28 release tests passed, including pause-before-configuration,
  reruns, wrong targets, stale revisions, disabled recovery, and activation order.
- Workspace lint, typechecks, builds and compiled shared-type imports passed.
  The frontend build retains its existing Spline asset/chunk warnings.

## Cloud preparation

The setup script ran successfully using the project administrator identity.
Readback confirmed:

| Resource | Verified state |
| --- | --- |
| `SCHEDULER_SECRET:1` | Enabled in Secret Manager |
| `siskop-daily-scheduler` | Paused; `5 0 * * *`, `Etc/UTC` (07:05 WIB) |
| `siskop-identity-recovery` | Paused; `*/15 * * * *`, `Etc/UTC` |
| Both targets | POST to the corresponding direct Cloud Run API routes; 330s deadline |
| Both authentication configurations | OIDC invoker/audience and shared-token header present |

No scheduler was force-run. The setup changed no API revision or traffic; the
previous main release still served `siskop-staging-api-00025-hig` at readback.

## Activation still requires the PR merge

The new routes and release step are not live yet. After merging this PR, the
successful main pipeline binds the secret, deploys the backend, and validates
the exact serving revision through the authenticated read-only status route.
It then resumes both jobs. This record proves preparation and local validation,
not a completed scheduled execution against the hosted application.
