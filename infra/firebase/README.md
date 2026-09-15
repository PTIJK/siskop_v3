# Firebase staging

Project: `siskop-d0f8c`, region: `asia-southeast2`.

Frontend: https://siskop-d0f8c.web.app

Firebase Hosting serves the existing Vite frontend and forwards `/api/**` and
`/uploads/**` to `siskop-staging-api` on Cloud Run. The API uses the existing
Prisma/PostgreSQL database. New registrations and public login use Firebase
Authentication (Google or email/password); Firestore and Data Connect are not used.

Registration confirmation emails use Resend after verified payment. Follow
[Resend setup](RESEND.md) to configure a sender, test the key, and enable Cloud Run.

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

## Resources

- Cloud SQL: `siskop-staging`, existing database `postgres`; migrations are versioned under `apps/backend/prisma/migrations`.
- Cloud Run: `siskop-staging-api`, 1 CPU, 1 GiB, min 0/max 1 instance, concurrency 20.
- Runtime account: `siskop-staging-api@siskop-d0f8c.iam.gserviceaccount.com`.
- Image repository: `asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api`.
- Private uploads bucket: `gs://siskop-d0f8c-staging-uploads`, mounted at `/mnt/uploads`.
- Secret Manager versions: `DATABASE_URL:2`; JWT keys, Xendit secrets, `TENANT_GATEWAY_SECRET`, and `SCHEDULER_SECRET` at version 1.
- Cloud Scheduler: daily interest/KOL at 07:05 WIB and Firebase recovery every 15 minutes;
  OIDC invoker `siskop-scheduler-invoker@siskop-d0f8c.iam.gserviceaccount.com` plus the app token.

Cloud Run reads secrets at runtime; they are never bundled into the frontend/image.
`.gcloudignore` permits only backend build inputs. The private local copy is
`apps/backend/.env.firebase-secrets.local` (gitignored, mode 0600). Never put its
values in a command argument, build substitution, commit, or chat.

## Database maintenance

Open the authenticated local proxy in a separate terminal:

```sh
cloud-sql-proxy --gcloud-auth --address=127.0.0.1 --port=55434 \
  siskop-d0f8c:asia-southeast2:siskop-staging
```

From the repository root:

```sh
node infra/firebase/database.mjs check
node infra/firebase/database.mjs migrate
node infra/firebase/database.mjs seed
node infra/firebase/check-hosted.mjs
```

The helper reads the private local connection string, restricts itself to this
staging instance, and connects through the proxy without printing credentials.
The seed creates only `Paket Lengkap (Demo)` at IDR 500,000; it preserves existing
package data and creates no preset accounts. Set the actual package catalog before
accepting live customers. Never run the backend integration suite against this
database: those tests delete test records and some suites truncate tenant data.
The hosted checker tests route/auth behavior and signed sample callbacks without
creating users or payments. See [verification record](VERIFICATION.md) for the
actual browser payment test and deployed image.

## Repeat a deployment

For automatic releases after merging into main, see
[continuous deployment](CONTINUOUS-DEPLOYMENT.md). The commands below are the
manual backend/frontend fallback; avoid running them during a pipeline release.

Run the backend tests against a separate local test database first, then typecheck
and lint. Build and deploy from the repository root:

```sh
gcloud builds submit . --project=siskop-d0f8c --region=asia-southeast2 \
  --config=infra/firebase/cloudbuild.yaml \
  --substitutions=_IMAGE=asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api:YOUR_UNIQUE_TAG

# Copy the sha256 digest from the successful build's results.images.
bash infra/firebase/deploy-api.sh asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api@sha256:YOUR_DIGEST

pnpm --filter @siskop/frontend exec tsc --noEmit
pnpm --filter @siskop/frontend exec vite build --mode staging
firebase deploy --only hosting --project=siskop-d0f8c
```

Hosting pins the backend revision so a Hosting release rollback restores its
associated API revision. Database migrations are separate and must remain
compatible with the revision being restored.

## Scheduled jobs

Cloud Scheduler cold-starts the API when needed. The Cloud Run entrypoint has no
in-process cron timer. Both jobs use the direct Cloud Run URL, OIDC from
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
`cloudscheduler.jobs.get` and `cloudscheduler.jobs.enable`. The release reads the
job header in memory for its authenticated readiness check; it does not read
Secret Manager. Do not print full job resources: their headers contain the token.

### Activation and operation

Merge the tested PR into main. The coordinated Cloud Build release deploys the
API with the pinned secret, verifies Hosting and promotes the direct API URL.
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

Check execution results in Cloud Scheduler and Cloud Run logs. Do not use
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

The existing Cloud SQL instance is a 30-day trial; this setup does not upgrade it.
Cloud Run scales to zero but build, artifact, storage, and network usage can still
incur charges under the project's billing plan. A one-instance limit is a staging
setting, not a billing cap. Plan database retention/export before the trial ends.

Before a live launch: provide the actual package catalog and domain routing,
configure the final Spline scene if desired, switch Xendit credentials/webhooks
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
Credentials with `firebaseauth.users.get`. Cloud Run uses its attached service
account with `roles/firebaseauth.viewer`; no service-account private key is used.
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
