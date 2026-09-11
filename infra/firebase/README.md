# Firebase staging

Project: `siskop-d0f8c`, region: `asia-southeast2`.

Frontend: https://siskop-d0f8c.web.app

Firebase Hosting serves the existing Vite frontend and forwards `/api/**` and
`/uploads/**` to `siskop-staging-api` on Cloud Run. The API uses the existing
Prisma/PostgreSQL database. New registrations and public login use Firebase
Authentication (Google or email/password); Firestore and Data Connect are not used.

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
only an explicit login after payment creates a dashboard session. Other staff/member subdomain logins
still require a suitable custom-domain deployment. Firebase's default `web.app`
hostname does not provide arbitrary cooperative subdomains.

## Resources

- Cloud SQL: `siskop-staging`, existing database `postgres`; five migrations.
- Cloud Run: `siskop-staging-api`, 1 CPU, 1 GiB, min 0/max 1 instance, concurrency 20.
- Runtime account: `siskop-staging-api@siskop-d0f8c.iam.gserviceaccount.com`.
- Image repository: `asia-southeast2-docker.pkg.dev/siskop-d0f8c/siskop-staging/api`.
- Private uploads bucket: `gs://siskop-d0f8c-staging-uploads`, mounted at `/mnt/uploads`.
- Secret Manager versions: `DATABASE_URL:2`; JWT keys and Xendit secrets at version 1.

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
