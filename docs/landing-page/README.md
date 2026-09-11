# Landing page and cooperative onboarding

Routes: `/` → `/register?package=<id>` → `/checkout` → `/login` → `/dashboard`.
Registration and login offer Google or email/password through Firebase.
`/checkout/resume` restores a registration using its verified Firebase identity.
The public login resolves the workspace from the verified UID binding; legacy
staff login at `/login/legacy` still resolves the tenant from the request Host header.

## Configure

1. Install dependencies, generate Prisma, and deploy the new migration:
   ```sh
   pnpm install
   pnpm --filter @siskop/types build
   pnpm --filter @siskop/backend db:generate
   pnpm --filter @siskop/backend exec prisma migrate deploy
   ```
2. Configure the backend `.env` using `.env.example`: database, JWT secrets, `XENDIT_SECRET_KEY`, `XENDIT_WEBHOOK_TOKEN`, `PUBLIC_APP_URL`, and `FIREBASE_PROJECT_ID`. Configure Firebase Admin Application Default Credentials with read access to Firebase Auth users for revocation checks. Set the four public `VITE_FIREBASE_*` entries in the frontend environment, enable Google and email/password, and authorize the frontend domain in Firebase.
3. `PUBLIC_APP_URL` must be the HTTPS **origin** of the frontend, without a path, query, or fragment. Xendit requires HTTPS return URLs even in test mode. For local provider testing use an HTTPS development tunnel/proxy; preserve same-origin `/api` proxying so the onboarding cookie returns to the correct host. Include that origin in `CORS_ORIGIN`.
4. In the Xendit dashboard, register `POST https://<public-api>/api/onboarding/webhook` for `payment_session.completed` and `payment_session.expired`. Use the dashboard's callback token as `XENDIT_WEBHOOK_TOKEN`. Keep both secrets server-side.
5. Configure actual paid packages in the existing platform administrator screen. The catalog reads active packages with a positive whole-rupiah price. No package prices are embedded in the frontend. Zero-price internal/test packages and fractional-rupiah prices are excluded from this paid signup flow.
6. Set frontend `VITE_PUBLIC_APP_HOST` to the public hostname, especially for multi-part domains such as `siskop.example.co.id`. Configure wildcard DNS/TLS and preserve the Host header through the API proxy for tenant login.
7. For the live 3D centerpiece, publish the approved Spline scene via **Export → Code → Vanilla JS** and set `VITE_SPLINE_SCENE_URL` to its `scene.splinecode` URL in the frontend environment. Match the emerald-ring art direction and enable appropriate pointer/scroll interactions in the scene. Rebuild the frontend after changing Vite settings.

Without provider configuration, visitors can browse real packages and the registration form, but paid registration is disabled. Without a Spline scene, the bundled original artwork floats with pointer parallax. The artwork also covers loading errors and reduced-motion preferences; the pause control and offscreen detection stop motion.

## Payment behavior

For sandbox testing, switch the Xendit dashboard to Test Mode and create a test secret key with Money-in Write permission. Store it as `XENDIT_SECRET_KEY` in the ignored backend `.env`, together with the test webhook callback token. Both modes use `https://api.xendit.co`; the API key selects the environment. Test checkout links can use `dev.xen.to` or `checkout-staging.xendit.co`. Use an HTTPS development origin and start registration from that origin so its cookie is present when Xendit returns. Configure the Payment Session Completed and Expired webhooks in Test Mode, then use the selected channel's documented simulation flow. Verify both the provider's completed status and successful dashboard access before considering the sandbox journey complete.

The integration uses Xendit `POST /sessions`, with `session_type: PAY`, `mode: PAYMENT_LINK`, automatic capture, IDR, and country ID. This collects the initial monthly payment once; it does not enroll automatic recurring charges. The existing billing date is set one month after successful payment. Renewal collection, reminders, refunds, and automatic expiry enforcement remain separate billing work.

Registration provisions the tenant, administrator, first unit, seeded roles, and order in a single transaction. The tenant stays inactive and receives no dashboard session until payment is confirmed. Price and package name are captured from the database when registering; changes to the catalog do not change an existing order's quoted amount.

An HTTP-only, SameSite=Lax cookie grants access to that registration only. Credentials are never stored in browser storage, query strings, or the checkout order. Resuming after a lost cookie requires a fresh Firebase sign-in by the original administrator. Confirmed payment clears the onboarding and staff cookies and redirects to login; it never exchanges an order cookie for a dashboard session. The backend verifies Firebase tokens and revocation, then resolves the unique UID binding to the SISKOP user. New registration passwords go directly to Firebase; PostgreSQL stores no password hash or salt for those accounts.

A PostgreSQL row lock serializes checkout creation across processes. Active links are reused. A new attempt is allowed after a definitive rejection or confirmed expiry/cancellation. An ambiguous provider timeout intentionally stays `CREATING`; operators should find that attempt's reference ID in Xendit and replay the authenticated session webhook before allowing another charge. Do not reset an ambiguous attempt blindly.

The webhook verifies `x-callback-token`, retrieves the authoritative session using the server API key, and checks its reference ID, session ID, currency, payment type, and exact Decimal amount. A transaction activates the tenant once. Duplicate or out-of-order callbacks cannot extend billing or downgrade a paid order. The browser's return URL never grants access. The status page polls the local database; its explicit check action reconciles against Xendit if the webhook is late.

Webhook deliveries accept either `data.payment_session_id` or `data.id` (the dashboard's Test & Save payload), rejecting conflicting IDs. Authenticated events whose reference does not match a local checkout attempt are acknowledged without payment updates or provider lookups; this lets dashboard samples such as `test_session` pass setup. A successful setup test confirms delivery and token verification; complete a real sandbox session to verify payment activation.

Public registration and checkout actions are rate-limited and reject cross-origin browser mutations. The default limiter store is process-local: production deployments with several API instances should use a shared store or equivalent ingress limits. Legacy `POST /api/auth/register` is disabled by default; the explicit development-only `ALLOW_LEGACY_REGISTRATION=true` override is never honored in production.

## Verification

Run the backend suite against a dedicated database whose name ends in `_test` (the existing tests delete fixture tenants):

```sh
pnpm --filter @siskop/backend test
pnpm --filter @siskop/frontend build
pnpm --filter @siskop/backend build
pnpm --filter @siskop/frontend lint
pnpm --filter @siskop/backend lint
```

`onboarding.test.ts` exercises registration, inactive login denial, authenticated order access, server pricing, concurrent creation, confirmed payment and dashboard access, duplicate/out-of-order delivery, amount mismatches, expiry/retry, ambiguous timeouts, recovery, and the legacy-route production gate. Provider responses are simulated in automated tests; no real payment is made.

Before live use, complete a Xendit test-mode payment through the configured HTTPS origin and published webhook, including a delayed callback, and verify the supplied Spline scene on desktop and mobile.

## References

- [Xendit payment session creation](https://docs.xendit.co/apidocs/create-session)
- [Xendit session reconciliation](https://docs.xendit.co/apidocs/get-session)
- [Xendit webhook authentication and retries](https://docs.xendit.co/docs/handling-webhooks)
- [Spline runtime](https://github.com/splinetool/react-spline)

Design source: `design.md` and the three adjacent concept PNGs. Intentional adaptations: real catalog records replace illustrative prices; registration includes the existing required operational principle field; mobile puts the selected package above the form; the payment form is hosted by Xendit; the existing dashboard is preserved.
