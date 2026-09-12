# Registration confirmation email

The email is sent after Xendit confirms payment and the cooperative becomes
active. It includes the package, paid amount, registration ID, and `/login` link,
with instructions for the chosen Google or email/password method. Passwords and
Firebase tokens never appear in the email. Firebase continues to manage passwords.

## 1. Create a Resend account and API key

1. Sign up at https://resend.com/signup and verify your account email.
2. Open **API Keys → Create API Key**. Name it `siskop-staging` and select
   **Sending access**. Restrict it to your sending domain when you have one.
3. Save the key in the gitignored `apps/backend/.env.resend.local` file:

   ```dotenv
   RESEND_API_KEY=""
   RESEND_FROM_EMAIL="SISKOP <onboarding@resend.dev>"
   ```

   Put the key between the first pair of quotes. Never put it in the frontend,
   GitHub, a build substitution, or chat.

The `onboarding@resend.dev` sender can email only the address associated with your
Resend account. Use that same email for an inbox test. Other recipients require a
domain you control.

## 2. Test the key and template locally

From the repository root:

```sh
pnpm --filter @siskop/types build
pnpm --filter @siskop/backend build
node infra/firebase/resend-setup.mjs check
node infra/firebase/resend-setup.mjs test YOUR_RESEND_ACCOUNT_EMAIL
```

Replace `YOUR_RESEND_ACCOUNT_EMAIL` with your address. `check` validates local
configuration only. `test` sends one marked test email using the registration
template; it creates no user, order, or payment. Check Resend **Emails** and your
inbox/spam folder. An accepted email ID means Resend accepted the request; its
delivery status confirms subsequent delivery. A 403 with the test sender usually
means the recipient is not your Resend account address. No key is printed.

For local registration tests, add the two variables to the backend's existing
`.env`, or restart the backend with the separate private file:

```sh
pnpm --filter @siskop/backend exec node --env-file=.env.resend.local --import=tsx src/main.ts
```

The normal `.env` supplies other settings. Use Xendit test credentials and the
existing HTTPS webhook setup for a local payment. Automated tests use mocked
providers and a separate database; they send no emails or real payments.

## 3. Verify a domain for other users

1. Open Resend **Domains → Add Domain**.
2. Enter a domain or sending subdomain you control, such as `mail.your-domain.com`.
   You cannot use the shared `siskop-d0f8c.web.app` or `gmail.com` domains because
   you do not control their DNS.
3. At your domain provider, copy the exact DNS record types, names, and values
   Resend shows, including its DKIM and sending SPF/MX records. Keep existing
   mailbox MX records; add the records at the names Resend specifies.
4. Click **Verify DNS Records** in Resend and wait for **Verified**.
5. Change the private sender to an address on that exact domain, such as
   `SISKOP <noreply@mail.your-domain.com>`. Ensure the key permits that domain,
   then repeat the local test.

Sending does not require a mailbox for that address. Receiving replies requires
a working mailbox; this integration does not configure inbound email.

## 4. Configure Firebase / Cloud Run

After the test succeeds, run this while no deployment is running:

```sh
node infra/firebase/resend-setup.mjs configure
```

Have `gcloud` on PATH and sign in as `yudith.octo@gmail.com`. Alternatively, set
`GCLOUD_BIN` to the SDK executable's path. The helper creates new versions of
`RESEND_API_KEY` and `RESEND_FROM_EMAIL` in Secret Manager via stdin, grants the
API runtime account access to these secrets, and pins those versions on a
candidate API revision without moving live traffic.

Merge `feature/email` into `main`. Cloud Build applies the additive
`RegistrationEmail` migration and deploys frontend/backend. The deploy script
uses `--update-secrets` so optional Resend bindings survive subsequent releases.
Build and migration accounts do not receive direct access to the email key.
For later sender/key changes, run `configure` and rerun the current main trigger
to publish the new configuration.

## 5. Verify a paid registration

1. Open the deployed registration form. Workspace address and cooperative type
   are generated/defaulted server-side.
2. Register with Google or email/password. Use your Resend account email while
   sending from `onboarding@resend.dev`.
3. Complete payment in Xendit Test Mode. Pending/expired payments send no email.
4. Confirm the checkout redirects to login and the email's button opens `/login`.
5. Find the email in Resend **Emails** using its `registration_id` tag. After the
   migration, run `paid-registrations.sql` in Cloud SQL Studio for email status,
   the Resend email ID, and any sanitized error code.

## Delivery and recovery

An outbox row is created atomically with first payment activation. Provider calls
run outside database transactions. A lease prevents simultaneous sends and can
be reclaimed after 60 seconds if the process stops. Retries use the same frozen
payload and `registration-complete/<orderId>` idempotency key. `SENT` records
permanently stop repeat sending; `SENT` means accepted by Resend, not confirmed
inbox delivery.

Email failure leaves payment `PAID` and login available. The webhook returns an
error so Xendit retries. Checkout reconciliation/completion also attempts pending
email without failing the user action. There is no background email worker or
separate Resend webhook in this flow.

Without configuration, email stays `PENDING` and callbacks are acknowledged.
After enabling Resend, replay the completed payment webhook from Xendit, or
resume the paid checkout and refresh payment status. Registrations paid before
this feature was deployed are not automatically backfilled.

Resend retains idempotency keys for 24 hours. Automatic sending stops at 23 hours
after the first attempt and marks the record `REVIEW` to avoid duplicates after
an ambiguous response. Check Resend's `registration_id` tag before any manual
retry or database repair; never blindly clear a sent/review record. If Xendit
exhausts its retries, investigate the error and replay the webhook within the
safe window after fixing the cause. Email delivery never gates paid access.

Sources: [API keys](https://resend.com/docs/dashboard/api-keys/introduction),
[test sender restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain),
[domain verification](https://resend.com/docs/dashboard/domains/introduction),
[idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[Xendit webhook handling](https://docs.xendit.co/docs/handling-webhooks).
