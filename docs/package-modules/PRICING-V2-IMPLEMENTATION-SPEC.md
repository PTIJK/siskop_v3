# SISKOP Pricing V2: Implementation Spec

Status: approved plan, 28 Oct 2026. Full analysis (impact, risks, rationale) lives in the Claude Doc "SISKOP Pricing Matrix Implementation — Impact, Changes, Plan".
Data source of truth for prices, limits and features: `pricing.seed.json` (same folder). Do not retype numbers from this file.

## 1. Goal

Replace the single-tier `SubscriptionPackage` with a configurable pricing and entitlement engine:

- Five packages: Free, Small, Medium, Enterprise, Custom.
- The platform owner configures packages, feature matrix, add-ons, support plans and rules in admin.siskop.com.
- New cooperatives choose a package on the registration page.
- The tenant app enforces features and volume limits from the tenant's subscription.

## 2. Settled decisions

| Topic | Decision |
| --- | --- |
| Volume add-on price period | YEARLY. Monthly-billed tenants pay 1/12 per month. |
| Custom package | No base price. Price = sum of chosen feature prices + volume add-ons. Base limits = Free (50 members, 1 user, 2 saving types, 2 loan types). |
| Yearly price | Fixed packages: explicit `priceYearly` (= 10 x monthly). Custom yearly = monthly x `yearlyMultiplier` (10). |
| Add-ons on fixed packages | Allowed; owner switch `addonsOnFixedPackages`. |
| Support plans SP.0 to SP.2 | Yearly only, selectable on any package including Free. Visits and SLA are recorded, not enforced. |
| Free tier | Permanent. Locked on Free: accounting book, manual journal, period closing. Free has COA, account mapping, SHU config. |
| Journal auto-posting | Requires `accounting_book`. Not on Free. |
| VAT | All prices exclude VAT. PPN is a separate line added to the final cost at `taxRate`, seeded at 11% (owner decision 2026-10-29) and editable by the owner. |
| Currency | IDR everywhere. No USD. |
| Payments | Architecture built now; payment gateway (GDC) connected later. Until then the owner marks invoices paid. |
| Grace and purge | `paymentGraceDays` = 7, unpaid registration purge = 14 days. Owner-editable. |
| Invoice number | `INV-YYYYMM-NNNN` |
| Free abuse rule | Optional setting `oneFreeTenantPerRegistrationNo`, off by default. |

## 3. Non-negotiable repo rules (see repo CLAUDE.md)

- Every tenant-scoped Prisma query filters by `tenantId` from `req.auth`/`req.tenant`, never from body or params.
- Money is `Decimal`; API returns amounts as strings.
- Zod on every input; `AppError` with codes; `ApiResponse<T>` envelope.
- Test first; 80% backend coverage gate.
- Pricing catalog tables are platform-level (no `tenantId`), read-only to tenants.

## 4. Data model (Prisma)

Live catalog tables are the owner's working draft. **Publish** writes an immutable snapshot (`PricingVersion`). The engine, the registration page and new subscriptions read the latest published snapshot only.

| Table | Change | Fields |
| --- | --- | --- |
| `SubscriptionPackage` | change | add `code`, `isCustom`, `isPublic`, `sortOrder`, `priceMonthly`, `priceYearly` (replace `price`), `maxMembers`, `maxUsers`, `maxSavingTypes` (rename of `maxSavingConfigs`), `maxLoanTypes` (new). Null limit = unlimited. Drop `modules` and `whitelabelEnabled` in a later release. |
| `Feature` | new | `key`, `name`, `parentId`, `requires[]`, `customPrice`, `priceGroup`, `sortOrder`, `isActive` |
| `PackageFeature` | new | `packageId`, `featureId`, `included`; unique pair |
| `VolumeAddon` | new | `itemKey` (MEMBERS, USERS, SAVING_TYPES, LOAN_TYPES), `stepQty`, `price`, `period` |
| `SupportPlan` | new | `code`, `yearlyCost`, `remote`, `onsite`, `visitsPerYear`, `slaHours`, `aiSupport` |
| `PricingSetting` | new (single row) | `yearlyMultiplier`, `enabledCycles`, `defaultPackageCode`, `customBaseLimits`, `addonsOnFixedPackages`, `paymentGraceDays`, `unpaidRegistrationPurgeDays`, `customEnabled`, `taxRate`, `paymentInstructions`, `oneFreeTenantPerRegistrationNo` |
| `PricingVersion` | new | `version`, `snapshot` (JSON of catalog), `publishedBy`, `publishedAt` |
| `PricingAuditLog` | new | actor, entity, before, after, at |
| `TenantSubscription` | new | `tenantId`, `packageId`, `pricingVersion`, `billingCycle`, `supportPlanId`, `selectedFeatureKeys[]`, `addons` (JSON qty per item), `snapshot` (effective features, limits, unit prices), `amountPerCycle`, `status` (PENDING_PAYMENT, ACTIVE, PAST_DUE, CANCELLED), `startsAt`, `nextBillingDate`, `createdVia` (REGISTRATION, ADMIN, MIGRATION), `limitOverrides` |
| `Tenant` | small change | keep `packageId`, `nextBillingDate` as denormalized pointers for the existing billing cron |
| `PaymentGatewayConfig` | new (platform) | `provider` (manual), `environment`, encrypted `credentials`, `enabledMethods[]`, `webhookSecret`, `invoiceExpiryHours`, `status` |
| `Invoice` | new | `tenantId`, `subscriptionId`, `number`, `type` (REGISTRATION, RENEWAL, ADDON, SUPPORT), `subtotal`, `taxRate`, `taxAmount`, `total`, `status` (OPEN, PAID, EXPIRED, VOID), `dueDate`, `gatewayRef`, `paymentUrl` |
| `Payment` | new | `tenantId`, `invoiceId`, `gatewayTxnId`, `method`, `amount`, `paidAt` |
| `WebhookEvent` | new | `provider`, `eventId` (unique), `payload`, `processedAt` |

Seed: `prisma/seed/pricing.ts` loads `pricing.seed.json`. The owner import/export uses the same shape, so seed and import cannot drift.

## 5. Pricing and entitlement engine (`apps/backend/src/lib/pricing`)

One module. No other code computes a price or reads limits directly.

- `quote(selection, version)`: line items + amount for one cycle.
- `validateSelection(selection, version)`: rejects unknown keys, missing `requires` or parents, Custom items already included free.
- `resolveEntitlements(subscription)`: effective features + limits (snapshot, then `limitOverrides`).
- `requireFeature(key)` middleware: `403 FEATURE_NOT_ENTITLED`.
- `assertQuota(item)` middleware: `403 QUOTA_EXCEEDED` with `{ item, limit, used }`. Check and insert in one transaction to avoid races.

Price:

```
fixed  : P = price_cycle(pkg) + sum_i ceil(q_i / s_i) * a_i
custom : P = sum_{f in F} c_f + sum_i ceil(q_i / s_i) * a_i      (features in one priceGroup count once)
total  : subtotal + subtotal * taxRate    (support plan yearly cost added once per year)
```

Effective limits: fixed = package limit + q_i; custom = `customBaseLimits` + q_i.

Entitlements are NOT in the JWT. Tenant app loads `GET /api/config/subscription` at login. Backend caches per tenant 60 s, cleared on any subscription change.

## 6. Platform owner (admin.siskop.com): Pricing area

Tabs: Packages · Feature matrix (grid + Custom price + requires + price groups; import/export) · Volume add-ons · Support plans · Rules · Simulator · Publish and history (diff, publish, rollback) · Payment (later, with GDC).
Tenant detail gets a Subscription card (package, cycle, add-ons, support plan, usage vs limits, next billing date, change package, override a limit, audited).

Endpoints (all platform-admin only, all writes audited):

- `GET/PUT /api/admin/pricing/packages`, `/features`, `/addons`, `/support-plans`, `/settings`
- `PUT /api/admin/pricing/matrix`
- `POST /api/admin/pricing/quote`
- `GET /api/admin/pricing/diff`, `POST /publish`, `GET /versions`, `POST /rollback`
- `POST /api/admin/pricing/import`, `GET /export`
- `PUT /api/admin/tenants/:id/subscription`
- `GET /api/admin/invoices`, `POST /api/admin/invoices/:id/mark-paid`
- Old `/api/admin/packages` stays as a deprecated alias.

## 7. Registration page

Wizard: 1 Basics · 2 Business type · **3 Package (new)** · 4 Type-specific setup · 5 **Review and account**.

- Package step: cards for published public packages, monthly/yearly toggle (shows saving), prices labelled excluding VAT, compare table from the matrix, support plan radio SP.0 to SP.2.
- Custom builder: feature tree (included locked, priced ticked, dependencies auto-tick), steppers for members/users/saving types/loan types, live total from the quote endpoint.
- Type must agree with package: Free and Small have KSP only; Konsumen or Pasar types need Medium+ or Custom with those units.
- Deep link `/register?package=small&cycle=yearly`.

Endpoints: `GET /api/public/pricing` (cached, no tenant data) · `POST /api/public/pricing/quote` (rate limited) · `POST /api/auth/register-tenant` extended with `subscription: { packageCode, billingCycle, supportPlanCode, featureKeys[], addons[] }` · `GET /api/auth/registration-status`.

Server never trusts a client price. It revalidates and recomputes.

On submit: create tenant, subscription snapshot, seeded roles and saving types. Free activates at once (no billing date). Paid: tenant `PENDING_PAYMENT`, invoice created and emailed, awaiting-payment page with `paymentInstructions`; the owner marks the invoice paid, which calls the idempotent `confirmPayment(invoiceId)`: invoice PAID, tenant ACTIVE, `nextBillingDate` = start + one cycle, receipt email, `TENANT_REGISTERED` notification.

## 8. Payments architecture (gateway connected later)

- Provider adapter interface: `createCheckout(invoice)`, `verifyWebhook(request)`, `getPayment(ref)`.
- Adapters now: `manual`, and a `gdc` stub that returns "not connected".
- `POST /api/webhooks/payments/:provider` exists and returns 501 until an adapter is connected.
- Renewal: cron creates the next invoice 30 days before due, reminders at 30 and 7 days, confirmation moves the date forward.
- Not paid after due date + `paymentGraceDays`: existing 402 block; confirming payment lifts it.
- Unpaid registration invoice: tenant stays `PENDING_PAYMENT`, cannot log in, purged after the purge window; owner can reissue.
- Out of scope now: GDC adapter, checkout redirect, owner Payment tab, webhook verification (about 5 person-days once GDC API docs and sandbox keys exist).

## 9. Enforcement map (tenant app)

| Module | Route / action | Check |
| --- | --- | --- |
| Members | `POST /api/members`, import | `assertQuota(members)` (active members) |
| Users | `POST /api/config/users`, reactivate | `assertQuota(users)` |
| Savings | `POST /api/config/saving-configs` | `assertQuota(savingTypes)` |
| Loans | `POST /api/config/loan-configs` | `assertQuota(loanTypes)` |
| Receivables | member receivable routes | `member_receivables` |
| Units | Konsumen, Pasar routes | `unit_konsumen`, `unit_pasar` |
| Reports | regulatory, accounting book, portfolio quality, market, consolidated | one key each |
| Accounting | manual journal, period closing; journal auto-posting | `manual_journal`, `period_closing`, `accounting_book` |
| Config | COA standard template, auto mapping, holidays, branch units, paid-in capital, whitelabel, workspace address | one key each |
| Auth | member self registration, member portal login, collector login | `self_registration`, `member_portal`, `collector_access` |
| Audit | audit trail views | `audit_trail` |
| AI | chatbot, OCR | `ai_chatbot`, `ocr` |

Replace the old single `accounting` flag. Frontend: `useEntitlements()`, locked nav items showing which package unlocks them, usage meters on create buttons, new Subscription page under Configuration. Over-limit tenants (after a downgrade or migration) are create-blocked, never auto-deleted.

## 10. Billing and migration

- Billing cron reads `amountPerCycle` and `nextBillingDate` from the subscription, skips Free, adds the yearly support fee on its anniversary.
- Migration script (one-off): create `TenantSubscription` for each live tenant (about 50, KSP), map old tiers to new packages using an owner-approved mapping table, keep current price and billing date, `createdVia = MIGRATION`, add `limitOverrides` where usage exceeds the new package. Dry run first on a staging copy.

## 11. Phases (about 50 person-days, about 5 weeks)

| Phase | Scope | Days | Needs |
| --- | --- | --- | --- |
| 0 | Confirm seed vs original workbook, feature keys, `requires` links, invoice wording | 2 | none |
| 1 | Prisma migrations, seed, `PricingVersion`, audit log, migration script (dry run) | 5 | 0 |
| 2 | Engine, middleware, public pricing + quote endpoints, cache | 6 | 1 |
| 3 | Owner pricing console (backend 4, frontend 7) | 11 | 2 |
| 4 | Registration (backend 3, frontend 5) | 8 | 2 |
| 4b | Payments foundation: adapter, invoices, payments, `confirmPayment`, 501 webhook route, owner invoice list + mark-paid, renewal invoicing | 6 | 1, 2 |
| 5 | Enforcement + tenant UI + billing cron change (backend 3, frontend 4) | 7 | 2 |
| 6 | QA, migration rehearsal, shadow mode, flags, docs | 5 | 3, 4, 5 |

Rollout: deploy schema and seed with `PRICING_V2` off → run tenant migration and review before/after → enable owner console, owner publishes v1 → enforcement in shadow mode for 1 week (log, do not block) → enable enforcement and new registration together → drop old columns one release later.

## 12. Tests (golden cases)

- Small monthly 500,000; Medium yearly 10,000,000; Enterprise yearly 23,500,000.
- Custom with Konsumen + Pasar + Laporan pasar = 400,000 per month.
- Whitelabel + Workspace address together = 1,000,000, not 2,000,000.
- Medium feature set bought one by one = 1,700,000; all priced features = 6,550,000 (sanity checks from the seed).
- Reject a selection missing a `requires` or parent.
- Tampered price on `register-tenant` is rejected.
- 51st member on Free returns `QUOTA_EXCEEDED`.
- Small tenant calling a Medium-only report returns `FEATURE_NOT_ENTITLED`.
- Owner publish changes the public catalog but not existing tenant snapshots.
- `confirmPayment` activates a pending tenant exactly once; a second call changes nothing.
- Two tenants on different packages: no entitlement or usage leak.
- Migration: per-tenant price, billing date and access identical before and after.

## 13. Inputs still needed from the owner

1. ~~VAT (PPN) rate~~: decided, seeded at 11%, owner-editable. Confirm the rate is still correct before go-live.
2. Bank transfer instructions text for invoices.
3. Approval of the old-tier to new-package mapping table (draft it from live data; do not run the migration before approval).
4. Later, for GDC: API docs, sandbox keys, signature scheme, supported methods, card auto-debit decision.
