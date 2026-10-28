# Firebase staging

Project: `siskop-d0f8c`, region: `asia-southeast2`.

Frontend: https://siskop-d0f8c.web.app

Firebase Hosting serves the existing Vite frontend and forwards `/api/**` and
`/uploads/**` through `siskop-central-gateway` on Cloud Run to the dedicated Contabo API. The API uses SISKOP’s private PostgreSQL cluster on Contabo. New registrations and public login use Firebase
Authentication (Google or email/password); Firestore and Data Connect are not used.

Registration confirmation emails use Resend after verified payment. Follow
[Resend setup](RESEND.md) to configure a sender and test the key in the SISKOP API runtime.

## Session compatibility

Firebase forwards only the `__session` cookie. `apps/backend/src/hosting/firebase.ts`
translates that cookie into the existing onboarding/staff/member cookie names at
the hosting boundary. The three sessions retain separate paths and their existing
HttpOnly, Secure, SameSite and expiry settings. Auth modules and the default local
server entrypoint keep their existing behavior. API responses are not cached.
The shared types barrel uses explicit `.js` export paths for plain Node ESM.
The final container build executes the compiled API imports before publishing.

`apps/frontend/.env.staging` configures the public host and enables the original
registration administrator to sign in at `/login` with Firebase. Only a verified
Firebase UID can select its bound SISKOP user; email alone never links accounts.
Payment completion clears the onboarding/staff cookies and returns to `/login`;
only an explicit login after payment creates a dashboard session. Tenant subdomains
use the separate App Hosting gateway described in the
[tenant-domain guide](../../docs/tenant-domains.md). Routing and rename flags stay
off until DNS/HTTPS and hosted validation are complete. Once routing is enabled,
payment completion returns the canonical tenant login URL. The default `web.app`
hostname does not provide arbitrary cooperative subdomains.

## Current resources

- Business API: dedicated `siskop-api-staging` container on Contabo.
- Database: dedicated PostgreSQL 17 cluster/database `siskop_staging` on Contabo, with no published SQL port. SISKOP shares no database, roles or volumes with Sentryx.
- Central Google gateway: `siskop-central-gateway` forwards API/uploads to `https://siskop-api.inovasijayakarsa.id:18443`.
- Compatibility Google URL: `siskop-staging-api` forwards existing integration calls to the same SISKOP API. Neither forwarding service has database credentials.
- Tenant/member sites: existing Firebase App Hosting and cooperative custom domains.
- Authentication: existing Firebase identities; email: Resend; payments: Xendit test mode.
- Uploads: private `gs://siskop-d0f8c-staging-uploads`, accessed by SISKOP's dedicated runtime identity.
- Database backups: client-side encrypted archives in `gs://siskop-d0f8c-db-backups`, including the final source export and verified authoritative Contabo restore.
- Historical Cloud SQL: `siskop-staging` remains stopped and unrecovered, preserved separately.

See the [completion record](../../docs/2026-10-28-contabo-migration-completion.md) and [Supabase retirement record](../../docs/2026-10-28-supabase-retirement.md) for current operational evidence and provider-deletion status.

## Database maintenance and releases

Migrations run in a dedicated one-shot container against SISKOP's private PostgreSQL cluster during the coordinated main release. Use [the Contabo runbook](../contabo/siskop/README.md). The old `database.mjs` and `deploy-api.sh` entry points deliberately fail before reading credentials or contacting a provider. There is no Cloud Run/Supabase business-backend fallback.

Never run integration tests against staging: they delete records and some truncate tenant data. Tests use a disposable local/CI PostgreSQL database. Applied Prisma migrations stay immutable, including historical provider-specific protection migrations; these are schema history rather than a dependency on that provider.

For deployment use the [coordinated pipeline](CONTINUOUS-DEPLOYMENT.md). Do not manually publish a frontend or repoint the database during a release. Recover newer data from an authoritative Contabo backup on an isolated compatible destination; never reopen the stale pre-cutover source as a writer.

## Scheduled jobs

Cloud Scheduler invokes the Contabo API. The API entrypoint has no
in-process cron timer. Both jobs use the Contabo HTTPS origin, OIDC from
`siskop-scheduler-invoker`, and an application-verified `x-scheduler-token`.
The shared token is required because this API also serves public Firebase routes.
Tenant subdomains cannot invoke these system endpoints.

| Job | Endpoint | Schedule |
| --- | --- | --- |
| `siskop-daily-scheduler` | `POST /api/scheduler/run-daily` | 00:05 UTC / 07:05 WIB daily |
| `siskop-identity-recovery` | `POST /api/scheduler/reconcile-identities` | Every 15 minutes |

The definitions live in `scheduler-jobs.json`. Daily calculations lock each
savings account before re-reading its balance and `lastInterestAt`; the credit,
timestamp, transaction and journal commit together. Overlapping deliveries cannot
credit the same UTC day twice. Existing accounts with an accrual timestamp catch
up missed days; an account's first accrual credits exactly one day. Partial daily
failures return HTTP 503 so a retry skips successful credits and retries failures.
Interest preserves the annual-rate /360 convention and daily rounding, using Decimal.

Identity recovery processes at most 100 unfinished provisioning records per run,
with the existing 15-minute grace period. It preserves accounts linked to a User
and removes only abandoned Firebase UIDs recorded by the provisioning service.
It does not import arbitrary database users, reset passwords, or send emails.
It requires `FIREBASE_ACCOUNT_PROVISIONING_ENABLED=true` and the runtime's existing
Firebase user read/delete permissions. Provider failures return non-2xx and the
ledger allows later recovery attempts.

### Prepare before merging

Authenticate gcloud as the project administrator, then run from the repo root:

```sh
node infra/firebase/setup-scheduler.mjs
```

This enables the Scheduler API, creates `SCHEDULER_SECRET:1` if absent, grants
runtime secret access, creates the invoker identity, and configures **both jobs
paused**. It preserves an existing version 1 and refuses a disabled/destroyed pin.
No Cloud Run revision or traffic is changed. New jobs initially target a read-only
GET, then are paused before their real POST targets are installed. Re-running the
script updates the same jobs and leaves them paused again.

The script also grants the Cloud Build identity a custom role containing only
`cloudscheduler.jobs.get`, `cloudscheduler.jobs.enable`, and `cloudscheduler.jobs.pause`. The release reads the
job header in memory for its authenticated readiness check; it does not read
Secret Manager. Do not print full job resources: their headers contain the token.

### Activation and operation

Merge the tested PR into main. The coordinated Cloud Build release deploys the
API with the pinned secret, verifies Hosting and verifies the Contabo API.
It then checks `GET /api/scheduler/status` using each job's token. Both jobs must
target the expected service and report the exact new revision and both features
ready before either is resumed. This check does not perform financial work or
remove accounts. Verification-only builds never configure or activate jobs.

Each job retries failures up to three times with 60–300 second backoff, bounded
by its next scheduled execution. The API timeout is 300 seconds; the Scheduler
attempt deadline is 330 seconds to allow startup/transit overhead. Requests that
outlive the deadline can overlap a retry; per-account locks and the recovery
ledger protect against duplicate effects. Review timeouts/backlogs as data grows.

Inspect only non-sensitive fields:

```sh
gcloud scheduler jobs list --project=siskop-d0f8c --location=asia-southeast2 \
  --account=yudith.octo@gmail.com \
  --format='table(name.basename(),state,schedule,timeZone,lastAttemptTime,status.code)'
```

Check execution results in Cloud Scheduler and the dedicated SISKOP API container logs. Do not use
"Force run" on the financial job just to test deployment: it performs real
accruals. Local integration tests use a disposable database and mocked Firebase.

A failed activation marks the release failed and retains its lock. The API may
already be serving the new revision; fix the reported configuration and retry
the main build. Resume calls are idempotent at the workflow level: enabled jobs
are left alone. If one resume fails after the other succeeded, retrying finishes
the remaining activation. For rollback to an API without these routes, pause
both jobs first, then restore Hosting and direct API traffic. A future successful
release resumes prepared jobs, including jobs manually paused for maintenance.

## Xendit test setup

Staging deploys with `XENDIT_MODE=test`, independently of `NODE_ENV=production`.
The backend accepts only a test secret key (`xnd_development_...`) in this mode;
a live key or invalid mode disables paid registration and provider requests.
The mode defaults to `test` if unset. The API origin remains `https://api.xendit.co`
because Xendit selects the environment from the API key. Secret values stay in
Secret Manager; the deployment pins `XENDIT_SECRET_KEY:1` and
`XENDIT_WEBHOOK_TOKEN:1`. The active staging revision was checked on 2026-10-27
and its pinned API key was a test key.

In Xendit **Test Mode → Settings → Webhooks**, set both **Payment Session –
Completed** and **Payment Session – Expired** to:

```
https://siskop-d0f8c.web.app/api/onboarding/webhook
```

Use **Test & Save** for each. Keep the callback token unchanged; it must match
the saved `XENDIT_WEBHOOK_TOKEN`. Unknown sample sessions are acknowledged without
activating a cooperative. Real callbacks are checked against Xendit's session API.

Choose the demo package, register with synthetic details, then select BCA bank
transfer on Xendit's test checkout and click **Simulasi Pembayaran**. Expect a
return to `/login?registered=1` after payment confirmation. Enter the same
email/password (or choose the same Google account), then confirm dashboard access.
An unpaid login returns to checkout without creating a dashboard session.

This is a sandbox deployment. The current payment buys one month and does not
renew automatically. A published custom Spline scene can be configured with
`VITE_SPLINE_SCENE_URL`; until supplied, the landing hero uses its animated artwork.

## Costs and remaining production work

The stopped historical Cloud SQL instance is preserved for separate data recovery. API and database use the existing Contabo VPS. Google hosting/forwarding, builds, artifacts, uploads, encrypted backups, monitoring and network usage can still incur charges. Container resource limits are not a billing cap or high availability.

Before a live launch: provide the actual package catalog and domain routing,
configure the final Spline scene if desired, explicitly set `XENDIT_MODE=live`
in the live deployment and switch Xendit credentials/webhooks
deliberately, and verify the full flow again. Existing in-memory request limits
reset on restart; scaling beyond staging requires a shared limiter. Review upload
access and the broader dashboard workflows before storing real member documents.

References: [Firebase cookies](https://firebase.google.com/docs/hosting/manage-cache#using_cookies),
[Hosting and Cloud Run](https://firebase.google.com/docs/hosting/cloud-run),
[Cloud SQL connection](https://cloud.google.com/sql/docs/postgres/connect-run),
[SQL trial](https://cloud.google.com/sql/docs/postgres/free-trial-instance).

## Firebase Authentication

The public web SDK configuration is in `apps/frontend/.env.staging`; copy the four
`VITE_FIREBASE_*` entries to `.env.local` for local development. These are public
project identifiers, not server credentials. Firebase allows `localhost`,
`siskop-d0f8c.web.app`, and `siskop-d0f8c.firebaseapp.com` for authentication.

The API requires `FIREBASE_PROJECT_ID=siskop-d0f8c` and Application Default
Credentials with `firebaseauth.users.get`. The Contabo runtime uses its dedicated SISKOP credential with scoped Firebase user permissions; Google forwarding services do not receive business/database credentials.
Local backend development also needs ADC authorized for this project.
`FIREBASE_AUTH_EMULATOR_HOST` is forbidden in production.

New `User` rows store `firebaseUid` and `authProvider`, with `passwordHash = NULL`.
Firebase stores salted password hashes. SISKOP never receives new registration
passwords and does not copy Firebase password hashes or salts into PostgreSQL.
Login checks revocation and requires authentication within ten minutes; refresh
retains the original Firebase authentication time and rejects disabled, deleted,
or revoked accounts. Password resets are available on the login page.
Existing staff credentials remain supported through the workspace login route.
The existing staging onboarding administrator was imported into Firebase with its
original bcrypt hash, then linked by a deterministic UID; the local hash was
removed. No email-only account linking or password reset was performed.
