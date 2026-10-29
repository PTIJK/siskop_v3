# Pricing V2: rollout and operations

Companion to [PRICING-V2-IMPLEMENTATION-SPEC.md](PRICING-V2-IMPLEMENTATION-SPEC.md). The spec says what to build; this says how to switch it on, what to watch, and how to back out. All six phases are built on `feature/package-configuration`. Nothing below has been run against real tenant data.

## 1. What exists

| Area | Where |
| --- | --- |
| Catalog, publish, versions, audit | Owner console `/platform/pricing`; `modules/pricing-admin`; tables `Feature`, `SubscriptionPackage`, `PricingVersion`, ... |
| Quote and entitlements | `lib/pricing/engine.ts`, `entitlements.ts`; public `GET /api/public/pricing` |
| Registration | `modules/onboarding` (free activates at once; paid waits for payment) |
| Invoices and payments | `lib/payments/`, owner page `/platform/invoices`, `/api/platform/invoices` |
| Daily billing job | `modules/billing/jobs.ts`, run inside `POST /api/scheduler/run-daily` |
| Enforcement | `middleware/enforcement.ts` (status + feature table), `withQuota` in create paths |
| Tenant UI | `/langganan` (Subscription page), locked nav, usage badges, payment banner |
| One-off migration | `pnpm pricing:migration-plan`, `pnpm pricing:migration-apply` |

## 2. The switch: `PRICING_V2_ENFORCEMENT`

Read on every request, so changing it needs a restart of the process only, not a deploy.

| Value | Effect |
| --- | --- |
| `off` (default) | Nothing is checked. Legacy package flags keep working exactly as before. |
| `shadow` | Everything is evaluated and every breach is logged as a `PRICING_SHADOW ...` line; nothing is blocked. Legacy flags still decide. |
| `on` | Blocks. Legacy accounting, whitelabel and pasar checks step aside; the subscription decides. A tenant with no subscription gets 402 on every data route. |

Log lines to watch in shadow mode:

- `PRICING_SHADOW PAYMENT_REQUIRED tenant=... reason=NO_SUBSCRIPTION|PAST_DUE|...`: this koperasi would be refused. `NO_SUBSCRIPTION` means it has not been migrated.
- `PRICING_SHADOW FEATURE_NOT_ENTITLED tenant=... feature=...`: a request used a feature its package lacks. Either the mapping gives it too little or someone really uses it.
- `PRICING_SHADOW QUOTA_EXCEEDED tenant=... item=... limit=... used=...`: a create would have been refused.

## 3. Rollout order

1. **Deploy** with the flag `off`. Run `pnpm --filter @siskop/backend db:migrate` (the Pricing V2 migrations are additive).
2. **Owner prepares the catalog** in `/platform/pricing`: confirm the VAT rate (seeded 11%), type the bank-transfer text into Rules (`paymentInstructions`), review prices, then **Publish** v1. Nothing is quoted or enforced before the first publish.
3. **Migration plan.** `pnpm pricing:migration-plan <mapping.json> --out plan.json` is read-only. The mapping is `{ "<legacy package id>": "<new package code>", "none": "<code>" }` and is the owner's decision; tenants with no entry are listed as unmapped and are never guessed. Review `lost` (features the tenant has today and the new package lacks) and `overrides` (usage already above the new limit; the apply step keeps it, never trims).
4. **Rehearse on a staging copy** of production: `pnpm pricing:migration-apply <mapping.json> --confirm`. Without `--confirm` it refuses. A tenant that would lose features is **blocked** unless `--allow-feature-loss` is given, and that flag should only be used after the owner has accepted the list. Inactive tenants are skipped and reported. Safe to repeat. Verify price, next billing date and access per tenant against the plan.
5. **Apply in production**, same command.
6. **Shadow for about a week**: set `PRICING_V2_ENFORCEMENT=shadow`. Clear the log lines above (fix mappings with `PUT /api/platform/tenants/:id/subscription`, or the Kelola dialog's successor). Check that the daily scheduler response has `billing` counters with `failed: 0`, and that renewal invoices appear in `/platform/invoices`.
7. **Go live**: set `on` and enable the new registration at the same time.
8. **One release later**: drop the deprecated columns and tables (`SubscriptionPackage.modules/whitelabelEnabled/customSubdomainEnabled/maxSavingConfigs`, `Tenant.packageId`, `OnboardingOrder`, `CheckoutAttempt`, `RegistrationEmail`) and the legacy entitlement middleware.

## 4. Back out

- **Instantly:** set the flag to `off` and restart. Access returns to the legacy rules. Invoices, subscriptions and owner pages are unaffected.
- **Undo the migration:** `Tenant.packageId` is never modified, so deleting the migrated rows restores the old state: `DELETE FROM "TenantSubscription" WHERE "createdVia" = 'MIGRATION';` (take a backup first; invoices already issued reference the subscription, so delete those invoices first if any exist).
- **Bad publish:** `POST /api/platform/pricing/rollback` re-publishes an older version. Existing subscriptions keep their own frozen snapshot either way.

## 5. Behaviour reference

**Payment standing (flag `on`)**

| Subscription | Reads | Writes |
| --- | --- | --- |
| `ACTIVE` | allowed | allowed |
| `PAST_DUE` | allowed | 402 `PAYMENT_REQUIRED` |
| `PENDING_PAYMENT`, `CANCELLED`, none | 402 | 402 |

Always reachable: sign-in, `/api/config/subscription`, notifications. Platform admins are exempt. Confirming payment lifts `PAST_DUE` at once.

**Daily billing job** (inside `/api/scheduler/run-daily`, returns `billing`):

- Creates a renewal invoice 30 days before `nextBillingDate` (due date = that date). Price is the one frozen on the subscription, plus the yearly support fee in the support anniversary month; VAT is the rate published at that moment.
- Emails the invoice, then once more when 7 days remain (Resend must be configured, otherwise it retries next run).
- Marks `ACTIVE` subscriptions `PAST_DUE` when an open renewal is more than `paymentGraceDays` past due, and notifies the owner (`BILLING_BLOCKED`).
- Deletes unpaid registrations: only `PENDING_PAYMENT` koperasi created through registration whose registration invoice is past its deadline (`unpaidRegistrationPurgeDays`) and that never paid. Tenants without a subscription (legacy) and admin-created or migrated tenants are never touched. The owner can **Terbitkan ulang** an invoice to extend the deadline.

**Owner actions** (`/platform/invoices`): mark paid (idempotent; records method, reference, date), void, reissue (registration invoices only). To reprice a renewal, void it: the next billing run issues a new one at current VAT.

**Quotas**: members, users (excluding platform admins), saving types and loan types, active rows only. Checked under a row lock, so simultaneous creates cannot take the same last seat. Existing data is never trimmed when a tenant is over its limit; only new creates are refused. Reactivating a user and accepting an invitation count as taking a seat.

## 6. Still needed from the owner

1. Bank-transfer text for invoices (`paymentInstructions`); until set, invoices say "petunjuk akan dikirim oleh tim SISKOP".
2. Approval of the old-package to new-package mapping table. Expect the owner to weigh this: mapping an ordinary legacy package to `free` removes about ten features that were open to everyone before (self-registration, audit trail, holidays, portfolio quality, member receivables, ...). The plan lists them per tenant.
3. Confirm the VAT rate is still correct before go-live.
4. Later, for GDC: API docs, sandbox keys, signature scheme, supported methods, card auto-debit decision. Until then `POST /api/webhooks/payments/:provider` answers 501 and the `gdc` adapter reports "not connected".

## 7. Known gaps and follow-ups

- **Ops (infra):** `infra/contabo/siskop/configure_runtime.py` still requires `XENDIT_SECRET_KEY` to start staging, `infra/firebase/staging-env.yaml` and `infra/tenant-web/preview-api.sh` still set Xendit variables, `infra/firebase/check-hosted.mjs` posts to the removed `/api/onboarding/webhook`, and `infra/firebase/*.sql` query the old checkout tables. None of the runtime reads them any more. Left untouched because they cannot be tested from here.
- **Legacy Kelola dialog** (`/platform/tenants`) still sets `Tenant.packageId` directly. After migration that changes nothing the tenant can do (the subscription decides when the flag is `on`) but it can mislead; retire it with the step 8 cleanup, and use the subscription dialog instead.
- **Legacy unpaid Xendit tenants** are inactive with no subscription. The purge job ignores them on purpose. Review them by hand.
- **Collector access** is checked at sign-in; an already-issued collector token keeps working until it expires (15 minutes access, refresh checks again).
- **Not built:** GDC gateway (adapter, checkout redirect, webhook verification), AI chatbot and OCR features (catalog entries exist, no code behind them), owner payment-settings tab, add-on purchase flow for an existing tenant (the owner changes a subscription through the tenant dialog).
- Docs that still describe the Xendit flow: `docs/landing-page/*`, `docs/tenant-domains.md`, `apps/frontend/src/features/onboarding/README.md`, the 2026-10-28 Contabo notes. Historical; superseded by this file.
