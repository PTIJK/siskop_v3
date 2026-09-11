# Firebase Auth update — 2026-09-11

Site: https://siskop-d0f8c.web.app
Backend revision: `siskop-staging-api-00003-8kz`.
Image: `sha256:a939102e8b6031ce9fb82760a6e4f942d0c7e04e190edc96bed8376e05d98e1a`.
Cloud Build: `3291ef72-45fb-45b5-b5fa-0178d2c18bfd`.

- Google and email/password enabled; localhost and both Firebase hosting domains authorized.
- Runtime uses attached credentials and read-only Firebase Auth permissions.
- Five migrations applied to staging, the isolated test DB, and local preview DB.
- 269 tests in 22 files passed: 93.51% lines, 81.71% branches, 91.66% functions.
  Firebase verification module: 100% lines/branches/functions.
- Backend/frontend typechecks and changed-file lint passed; staging builds passed.
- New registration switch hides email/password inputs when Google is selected.
- Real hosted email/password registration created a Firebase user and an inactive
  SISKOP workspace with `passwordHash = NULL` before payment.
- BCA sandbox simulation returned automatically to `/login?registered=1` after
  the provider-confirmed payment. No manual reconciliation or DB activation.
- Visiting `/dashboard` before signing in returned to `/login`.
- Explicit email/password login opened the correct dashboard. Reload, logout,
  and a fresh-tab login on the final frontend all succeeded. Final tab: no errors.
- One stale lazy-loaded asset appeared while a new Hosting version was published
  during testing. Reloading loaded the new version; the fresh-tab flow was clean.
- Existing staging administrator imported with its original bcrypt credential,
  checked for identity conflicts, and linked by UID. Its original password still
  works in Firebase and SISKOP. No email-only linking or password reset was used.
- Hosted route/auth/webhook checks passed; frontend contains none of the five
  private backend secret values.
- Google token verification and tenant binding are covered by automated tests.
  Interactive Google popup completion still needs the user's normal-browser check;
  the in-app browser did not expose the popup. Do not claim a Google account E2E pass.

Synthetic workspace: `uji-auth-mtweu7v5`. Private generated credentials remain at
`/tmp/siskop-landing-tools/firebase-auth-e2e.json`. Only sandbox money was used.
The prior verification below records the earlier deployment and its original flow.

---

# Staging verification — 2026-09-10

Site: https://siskop-d0f8c.web.app

Backend: `siskop-staging-api-00002-prt` in `asia-southeast2`.
Image digest: `sha256:8cf24a6003b2dd25805744a5c980acdead63abb5bebd23dbd5e95b790e9045df`.
Successful Cloud Build: `6f9aa845-7961-4db8-ad11-8e978cf6fc37`.

## Verified

- Cloud SQL credentials work; all four Prisma migrations applied to the existing
  `postgres` database on the staging trial instance.
- 255 backend tests in 21 files passed on the isolated local test database.
  Coverage: 93.49% lines, 82.02% branches, 91.52% functions. Hosting adapter: 100%.
- Backend and frontend typechecks/lint passed. Frontend staging build passed.
- Compiled Node startup reproduced an existing extensionless shared-export failure;
  explicit `.js` exports fixed it. The final Docker stage now verifies API imports.
- Hosted API reads the database catalog and reports checkout available.
- Anonymous session requests fail with 401; legacy registration and untrusted
  onboarding origins fail with 403. Invalid webhook tokens fail with 401.
- Both authenticated sample webhook formats/events succeed without activating orders.
- User confirmed Completed and Expired webhooks were saved to the permanent
  Firebase endpoint in Xendit Test Mode.
- In the browser: selected `Paket Lengkap (Demo)`, registered a synthetic cooperative,
  opened Xendit staging checkout, selected BCA, and clicked **Simulasi Pembayaran**.
- Xendit returned to `/checkout`, displaying **Pembayaran berhasil** automatically.
  No manual reconcile request or database activation was used.
- Cloud Run logged the real payment callback as HTTP 200 at approximately
  `2026-09-10T15:44:08Z`.
- Entered `/dashboard`; reloaded successfully; logged out and signed in again at
  `/login` using the original registration administrator.
- PDF report endpoint returned HTTP 200, `application/pdf`, valid `%PDF-` signature
  and 43,782 bytes for the synthetic cooperative.
- A harmless object written to the private uploads bucket was served through
  Firebase `/uploads/**`, proving the persistent mount and combined rewrite.
- No application browser errors observed. Xendit's page emitted a Datadog size warning.
- Built frontend assets contain none of the five saved secret values.

The synthetic cooperative `uji-firebase-0910` remains available in the staging
database. Its random test credentials are stored privately in
`/tmp/siskop-landing-tools/firebase-test-account.json`, not in the repository.
No real payment was made.

## Scope

This verifies sandbox onboarding and the original administrator's dashboard access.
The catalog currently contains one demo package. Custom tenant-domain routing,
additional staff/member login hosting, a supplied custom Spline scene, live Xendit
credentials, and recurring renewal are outside this verified staging flow.
See [deployment guide](README.md) for configuration and operational details.

Git setup was resolved on 2026-09-11: this folder now has its own repository,
with `origin` pointing to `https://github.com/PTIJK/siskop_v3.git` and
`feature/landingPage` based on the existing `main` history. The unrelated parent
repository was not changed.
