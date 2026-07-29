# 05 — Database Schema: SISKOP

Status: generated directly from `apps/backend/prisma/schema.prisma` and its applied migrations, as
of **2026-07-29**. Source of truth is the Prisma schema file — if this document and the schema
disagree, the schema is right and this document is stale. Supersedes the 2026-07-27 version of this
document, which described the original 8-model scaffold (`Tenant`/`User`/`Member`/`SavingsAccount`/
`Loan`/`Transaction`/`CooperativeUnit`/`UnitMembership`) before the pre-rescaffold KSP product and
the Phase 2 SaaS-packaging work were merged in.

Database: PostgreSQL 15. Local dev connects on host port **5433** (mapped to the container's
5432 — see `docker-compose.yml`); CI uses the standard 5432 on a clean runner.

## 1. Migration history

| Migration | Adds |
|---|---|
| `20260728045148_init_merged_schema` | All 22 models below, in one migration — the pre-rescaffold KSP schema (Role/Member/SavingConfig/Saving/SavingTransaction/LoanConfig/Loan/LoanPayment/Account/AccountMapping/JournalEntry/JournalLine/SubscriptionPackage/WhitelabelConfig/Notification/NotificationRead/ShuDistributionConfig/CalkNarrative) layered under the rescaffold's multi-tenant core (`Tenant`/`CooperativeUnit`/`UnitMembership`/`User`) |
| `20260728050338_add_tenant_cascade_deletes` | `onDelete: Cascade` from `Tenant` down through every child table that didn't already have it |

Run migrations with `pnpm --filter @siskop/backend db:migrate` (dev, creates a migration) or
`prisma migrate deploy` (CI/prod, applies existing migrations only).

## 2. Conventions used throughout

- **Primary keys**: `String @id @default(cuid())` on every table — collision-resistant IDs
  generated in application code, not sequential integers.
- **Money**: `Decimal(15, 2)` for amounts/balances/prices, `Decimal(8, 4)` for interest/margin/
  bagi-hasil rates, `Decimal(5, 2)` for SHU-distribution percentages. Never `Float`/`Int`
  (`CLAUDE.md` rule 2).
- **Timestamps**: `createdAt DateTime @default(now())` on nearly every table; `updatedAt DateTime
  @updatedAt` where the row is ever mutated after creation. Append-only ledger tables
  (`SavingTransaction`, `LoanPayment`, `JournalEntry`, `JournalLine`) have no `updatedAt` — ledger
  rows are never mutated once written.
- **Tenant scoping**: every table except `UnitMembership` and `NotificationRead` carries a direct
  `tenantId` column, even on tables reachable through a join (e.g. `Saving`, `JournalLine`) — this
  is deliberate denormalization so the tenant-isolation predicate is always a single indexed
  column, never a multi-hop join (`CLAUDE.md` rule 1).
- **Enums modeled as real Postgres enums** (a change from the pre-merge scaffold, which used plain
  `String` columns): `TenantType`, `SavingType`, `RateType`, `TransactionType`, `LoanType`,
  `LoanStatus`, `KOLCategory`, `DomainStatus`, `NotificationType`, `AccountCategory`,
  `NormalBalance`, `MappingSourceType`, `MappingTransactionKind`, `JournalSourceType`,
  `JournalEntryStatus`, `CalkSection` — 16 enums total, all DB-enforced. `CooperativeUnit.type` is
  the one exception still kept as a plain `String`, validated only by Zod's `CooperativeType` at
  the application boundary.
- **Cascade deletes**: `onDelete: Cascade` from `Tenant` down through every child table (added in
  `20260728050338_add_tenant_cascade_deletes`) — deleting a tenant deletes everything under it.
  Deleting a `CooperativeUnit`, `SavingConfig`, `LoanConfig`, or `Account` while rows still
  reference it is a foreign-key violation, not a silent cascade — those relations intentionally
  have no cascade, since a unit/config/account with financial history shouldn't disappear quietly.
- **Fine-grained RBAC lives in `Role.permissions` (JSON), not a column enum.** `User` has no stored
  `role` string — the coarse `AuthClaims.role` (`super_admin`/`tenant_admin`/`accountant`/`member`)
  used for platform-admin gating is *derived* at login/refresh time (`deriveUserRole()`), never
  persisted. See §3.4/§3.5.

## 3. Tables

### 3.1 `SubscriptionPackage`

A tier of SaaS features a platform admin can assign to a tenant — see
`apps/backend/src/middleware/entitlement.ts`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `name` | String | | e.g. "Paket Lengkap (Demo)" |
| `price` | Decimal(15,2) | | Per billing period, Rupiah — no currency code (single-currency assumption) |
| `modules` | String[] | | Add-on module keys this package entitles the tenant to. Currently only `"accounting"` is checked anywhere (`requireAccountingEntitlement`) |
| `maxUsers` | Int | | Not yet enforced by any route — column exists, no quota check reads it |
| `maxMembers` | Int | | Not yet enforced |
| `maxSavingConfigs` | Int? | nullable | `null` = unlimited. Not yet enforced (the backup this was ported from had a `requireSavingConfigQuota` middleware; it was not re-ported) |
| `whitelabelEnabled` | Boolean | default `false` | Gates `WhitelabelConfig` writes (`requireWhitelabelEntitlement`) |
| `isActive` | Boolean | default `true` | Deactivated packages stay assigned to whichever tenants already have them; only removed from the platform-admin "assign a package" picker |
| `createdAt` | DateTime | default `now()` | |

A tenant with `packageId: null` (self-service registrations default to this, unchanged by this
session's work) is treated as having **no add-on modules** — see §3.2 and
`docs/01-PRD-SISKOP.md` §8.

### 3.2 `Tenant`

The cooperative (koperasi) itself — the root of tenant isolation. No `email`/`phone` column exists
on this model (a divergence from the pre-2026-07-29 version of this document, which described a
scaffold-era `Tenant.email`/`Tenant.phone` that no longer exist post-merge).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `name` | String | | Display name |
| `slug` | String | **Unique** | Login subdomain, e.g. `demo` → `demo.localhost:3000`. Resolved from the request's `Host` header (`slugFromHost`), never the request body |
| `address` | String | | |
| `registrationNo` | String | **Unique** | Official cooperative registry number |
| `type` | `TenantType` | | `SYARIAH` \| `KONVENSIONAL` |
| `cooperativeType` | String | default `"KSP"` | Display label (e.g. "Koperasi Simpan Pinjam") — a different axis from `CooperativeUnit.type`; free-form, not an enum |
| `logoUrl` | String? | nullable | |
| `packageId` | String? | FK → `SubscriptionPackage.id`, nullable | `null` until a platform admin assigns one via `PUT /platform/tenants/:id` |
| `isActive` | Boolean | default `true` | An inactive tenant's users cannot log in |
| `nextBillingDate` | DateTime? | nullable | Set by a platform admin; drives the (unbuilt) billing-reminder notification flow — `Notification.type = BILLING_BLOCKED`/`PACKAGE_CHANGED` exist as enum values with no scheduler writing them yet |
| `billingReminder30SentAt` / `billingReminder7SentAt` | DateTime? | nullable | Reserved for that same unbuilt reminder flow |
| `modalDisetor` | Decimal(15,2)? | nullable | Paid-in capital — Permenkop UKM No. 2/2024 Pasal 12 mandatory-audit threshold (Rp 5,000,000) compliance field. Tenant self-service via `GET/PUT /config/modal-disetor`, never gated by the accounting entitlement (a general compliance field, not part of the Konfigurasi Akun module) |
| `auditThresholdNotifiedAt` | DateTime? | nullable | Reserved for an (unbuilt) notification once `modalDisetor` crosses the threshold |
| `createdAt` | DateTime | default `now()` | |

Every tenant has **at least one** `CooperativeUnit` at all times — enforced in application code
(`provisionTenantInTx()`, called by both self-service `registerTenant()` and platform-admin
`createTenant()`), not a DB constraint (Postgres cannot express "at least one child row").

### 3.3 `CooperativeUnit`

A tenant's business line. `type` + count together define whether a tenant is single-purpose or a
koperasi serba usaha (KSU) — see `docs/01-PRD-SISKOP.md` §4.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `type` | String | | `KSP` \| `KONSUMEN` \| `PRODUSEN` \| `JASA` \| `PEMASARAN` — the one enum kept as a plain `String`, Zod-validated (`CooperativeType`) rather than a Postgres enum |
| `name` | String | | |
| `isActive` | Boolean | default `true` | Deactivating the tenant's only active unit is rejected (`config/service.ts::updateUnit`) — the "≥1 active unit" invariant holds post-provisioning too, not just at creation |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@index([tenantId, isActive])`, `@@index([tenantId, type])`.

### 3.4 `Role`

Tenant-scoped, custom fine-grained RBAC — a JSON permissions blob (`module → action → boolean`),
distinct from the coarse JWT `AuthClaims.role`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `name` | String | | Every tenant is seeded with 4 roles at provisioning: Super Admin, Manager, Teller, Viewer |
| `permissions` | Json | | Shape: `Permissions` in `packages/types/src/role.ts` — one `ModulePermissions` (`create`/`read`/`update`/`delete`/`export`, all optional) per module (`dashboard`/`members`/`savings`/`loans`/`reports`/`config`/`users`/`roles`/`accounting?`) |
| `createdAt` | DateTime | default `now()` | |

Checked per-route via `requirePermission(module, action)` (`middleware/rbac.ts`) — a pure JWT-claim
check (`permissions` rides in the access token), no DB round trip per request.

### 3.5 `User`

A login identity. No `role` column — the coarse role is derived, not stored.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `roleId` | String | FK → `Role.id` | The fine-grained RBAC axis |
| `email` | String | Unique **per tenant** (`@@unique([tenantId, email])`) | Not globally unique — one person can administer more than one koperasi as two different `User` rows |
| `passwordHash` | String | | bcrypt, 10 rounds |
| `name` | String | | |
| `isActive` | Boolean | default `true` | Inactive users are rejected at login and refresh |
| `isPlatformAdmin` | Boolean | default `false` | `true` marks a cross-tenant SISKOP platform operator. `AuthClaims.role` is computed as `"super_admin"` when this is `true`, regardless of the tenant role they're attached to (see below) |
| `lastLoginAt` | DateTime? | nullable | |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@index([tenantId])`, plus the implicit unique index from `@@unique([tenantId, email])`.

**Platform admins still need a `tenantId`/`roleId`** (both required, non-nullable columns) purely
to satisfy this FK constraint — `createPlatformAdmin()` attaches them to the creating admin's own
tenant/role. This is an FK-satisfying artifact, not intent for them to administer that tenant: the
frontend (`AppLayout.tsx`, `Sidebar.tsx`) explicitly hides that tenant's business modules and
redirects `isPlatformAdmin` users away from any route outside `/platform/*` and `/profile`, even
though their JWT technically carries real permissions for the attached tenant. See
`docs/04-System-Architecture-SISKOP.md` §6.

`deriveUserRole()` (`lib/user-mapper.ts`) computes the coarse `AuthClaims.role`:
`isPlatformAdmin → "super_admin"`; else `role.name ∈ {"Teller","Viewer"} → "accountant"`; else
`"tenant_admin"`. `"member"` is never produced here — members don't log in (see §3.6).

### 3.6 `Member`

A koperasi member's identity. Deliberately carries **no login** — unlike the original scaffold's
1:1 `Member ↔ User` design, members are managed by staff and never authenticate themselves.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `memberId` | String | **Unique (global)** | Human-readable membership number, e.g. `KOP-BRK-202606-0001` |
| `accountNumber` | String | **Unique (global)** | |
| `fullName` | String | | |
| `nik` | String | Unique **per tenant** (`@@unique([tenantId, nik])`) | Indonesian national ID number |
| `address`, `birthPlace`, `occupation` | String | | |
| `birthDate` | DateTime | | |
| `ktpPhotoUrl` | String? | nullable | Served from `/uploads/ktp/{tenantId}/{file}`, a URL built explicitly server-side rather than reusing multer's OS path (fixes a Windows-path bug the pre-rescaffold code had) |
| `isActive` | Boolean | default `true` | Soft-delete flag — members are deactivated, never hard-deleted |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@index([tenantId])`, `@@index([fullName])`, plus the implicit unique indexes.

Which units a member participates in is `UnitMembership` (§3.7), not a column here.

### 3.7 `UnitMembership`

Join table: which units a member actually participates in.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `memberId` | String | FK → `Member.id`, `onDelete: Cascade` | |
| `unitId` | String | FK → `CooperativeUnit.id`, `onDelete: Cascade` | |
| `joinedAt` | DateTime | default `now()` | |

Indexes: `@@unique([memberId, unitId])` (prevents duplicate joins), `@@index([unitId])`.

No `tenantId` column — tenant is always reachable through `memberId`/`unitId`.

### 3.8 `SavingConfig` / `WhitelabelConfig`

**`SavingConfig`** — a savings *product* the tenant offers (not a member's account balance; that's
`Saving`, §3.10).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `name` | String | | e.g. "Simpanan Pokok" |
| `type` | `SavingType` | | `POKOK` (mandatory initial) \| `WAJIB` (mandatory recurring) \| `SUKARELA` (voluntary) |
| `rateType` | `RateType` | | `BUNGA` (interest, konvensional) \| `BAGI_HASIL` (profit-sharing, syariah) \| `MARGIN` |
| `rate` | Decimal(8,4) | | |
| `periodUnit` | String | | `MONTHLY` \| `YEARLY` (Zod-validated, not a DB enum) |
| `isDefault` | Boolean | default `false` | Distinguishes the seeded Pokok/Wajib/Sukarela trio from tenant-added custom configs — `maxSavingConfigs` (§3.1) is meant to cap the latter, not implemented yet |
| `isActive` | Boolean | default `true` | |
| `createdAt` | DateTime | default `now()` | |

**`WhitelabelConfig`** — one row per tenant (1:1), a tenant's custom-domain/branding config.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, **unique**, `onDelete: Cascade` | |
| `customDomain` | String? | **Unique (global)**, nullable | |
| `domainStatus` | `DomainStatus` | default `PENDING` | `PENDING` \| `VERIFIED` \| `FAILED`. Resubmitting a new `customDomain` resets this to `PENDING`; nothing verifies domains yet (no DNS/TLS automation exists) |
| `primaryColor` | String? | nullable | Hex color, Zod-validated (`^#[0-9a-fA-F]{6}$`) at the API boundary, not a DB constraint |
| `hideBranding` | Boolean | default `false` | |
| `emailSenderName` / `emailSenderAddress` | String? | nullable | Reserved — no outbound email sending exists yet |
| `createdAt` / `updatedAt` | DateTime | | |

Read (`GET /config/whitelabel`) is ungated; writes require `SubscriptionPackage.whitelabelEnabled`
(`requireWhitelabelEntitlement`).

### 3.9 `Notification` / `NotificationRead`

Platform-admin-facing, in-app only — no route consumes these yet (seeded with one row per
`NotificationType` for future UI work).

| `Notification` column | Type | Notes |
|---|---|---|
| `id` | String PK | |
| `type` | `NotificationType` | `TENANT_REGISTERED` \| `BILLING_BLOCKED` \| `PACKAGE_CHANGED` \| `AUDIT_THRESHOLD_EXCEEDED` |
| `title`, `message` | String | |
| `relatedTenantId` | String?, FK → `Tenant.id` (no cascade) | |
| `createdAt` | DateTime | |

`NotificationRead` is a per-user read-state row (`@@unique([notificationId, userId])`) — a row's
*absence* means unread for that user.

### 3.10 `Saving` / `SavingTransaction`

**`Saving`** — a member's actual balance for one `SavingConfig`, in one `CooperativeUnit`.
`unitId` is always resolved server-side from the tenant's sole unit (`lib/units.ts`), never
accepted from the client — no unit-picker UI exists.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `unitId` | String | FK → `CooperativeUnit.id` (no cascade) | |
| `memberId` | String | FK → `Member.id` (no cascade) | |
| `savingConfigId` | String | FK → `SavingConfig.id` (no cascade) | |
| `balance` | Decimal(15,2) | default `0` | Mutated only by `SavingTransaction`-writing service code (`modules/savings/service.ts`), never written directly elsewhere |
| `isActive` | Boolean | default `true` | A member's Simpanan Pokok can never be withdrawn to zero-and-closed (`CANNOT_WITHDRAW_POKOK`) |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@index([tenantId])`, `@@index([tenantId, unitId])`, `@@index([memberId])`.

**`SavingTransaction`** — append-only ledger of deposits/withdrawals against one `Saving`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `savingId` | String | FK → `Saving.id` (no cascade) | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `type` | `TransactionType` | | `DEPOSIT` \| `WITHDRAWAL` |
| `amount` | Decimal(15,2) | | |
| `note` | String? | nullable | |
| `createdBy` | String | FK → `User.id` | Which staff member recorded it |
| `createdAt` | DateTime | default `now()` | No `updatedAt` — append-only |

Indexes: `@@index([savingId])`, `@@index([tenantId])`, `@@index([createdAt])`.

### 3.11 `LoanConfig` / `Loan` / `LoanPayment`

**`LoanConfig`** — a loan *product* (rate, max term). Same shape as `SavingConfig` for the loans side.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `name` | String | | |
| `type` | `LoanType` | | `SYARIAH` \| `KONVENSIONAL` |
| `rateType` | `RateType` | | Syariah configs use `MARGIN` (flat margin, not amortized interest — see `lib/loan-calc.ts`) |
| `rate` | Decimal(8,4) | | |
| `maxTermMonths` | Int | | |
| `isActive` | Boolean | default `true` | |
| `createdAt` | DateTime | default `now()` | |

**`Loan`** — a member's actual loan instance.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `unitId` | String | FK → `CooperativeUnit.id` (no cascade) | Resolved server-side, same as `Saving` |
| `memberId` | String | FK → `Member.id` (no cascade) | |
| `loanConfigId` | String | FK → `LoanConfig.id` (no cascade) | |
| `principalAmount` / `totalAmount` / `monthlyPayment` / `remainingAmount` | Decimal(15,2) | | Computed at issuance by `lib/loan-calc.ts` |
| `termMonths` | Int | | |
| `status` | `LoanStatus` | default `ACTIVE` | `PENDING` \| `ACTIVE` \| `COMPLETED` \| `DEFAULTED` |
| `kolCategory` | `KOLCategory` | default `LANCAR` | Kolektibilitas: `LANCAR` \| `DALAM_PERHATIAN` \| `KURANG_LANCAR` \| `DIRAGUKAN` \| `MACET` — recalculated from `daysOverdue` (`lib/kol.ts`) |
| `daysOverdue` | Int | default `0` | |
| `disbursedAt` | DateTime? | nullable | |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@index([tenantId])`, `@@index([tenantId, unitId])`, `@@index([memberId])`,
`@@index([status])`, `@@index([kolCategory])` (the last anticipates portfolio-risk reporting
queries grouped by KOL class).

**`LoanPayment`** — append-only repayment ledger.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `loanId` | String | FK → `Loan.id` (no cascade) | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `amount` | Decimal(15,2) | | Principal + interest/margin portion |
| `penalty` | Decimal(15,2) | default `0` | Overdue penalty, if any |
| `paidAt` / `dueDate` | DateTime | | |
| `note` | String? | nullable | |
| `createdBy` | String | FK → `User.id` | |
| `createdAt` | DateTime | default `now()` | No `updatedAt` |

Indexes: `@@index([loanId])`, `@@index([tenantId])`, `@@index([dueDate])`.

### 3.12 `Account` / `AccountMapping` — Chart of Accounts (Konfigurasi Akun)

**`Account`** — one row per ledger account, self-referencing for a header/child hierarchy.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `code` | String | Unique **per tenant** (`@@unique([tenantId, code])`) | e.g. `1-1000` |
| `name` | String | | e.g. "Kas" |
| `category` | `AccountCategory` | | `ASET` \| `KEWAJIBAN` \| `EKUITAS` \| `PENDAPATAN` \| `BEBAN` |
| `normalBalance` | `NormalBalance` | | `DEBIT` \| `KREDIT` |
| `parentId` | String? | FK → `Account.id` (self, no cascade), nullable | |
| `isHeader` | Boolean | default `false` | Header accounts group children, never post directly |
| `isDefault` | Boolean | default `false` | Distinguishes the seeded standard COA template from tenant-added accounts |
| `isCashEquivalent` | Boolean | default `false` | Feeds the "Kas"/cash-equivalent rollup on Neraca |
| `isActive` | Boolean | default `true` | Deactivation is blocked if the account has children, is referenced by an `AccountMapping`, or already has `JournalLine` postings |
| `createdAt` / `updatedAt` | DateTime | | |

Access gated by `requireAccountingEntitlement` (`SubscriptionPackage.modules` must include
`"accounting"`) — see `docs/04-System-Architecture-SISKOP.md` §3.5.

**`AccountMapping`** — which debit/credit account a given transaction kind posts to.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `sourceType` | `MappingSourceType` | | `SAVING_CONFIG` \| `LOAN_CONFIG` \| `SYSTEM` |
| `sourceId` | String? | nullable | The `SavingConfig`/`LoanConfig` id this mapping applies to (null for `SYSTEM`) |
| `transactionKind` | `MappingTransactionKind` | | `DEPOSIT` \| `WITHDRAWAL` \| `DISBURSEMENT` \| `PAYMENT_PRINCIPAL` \| `PAYMENT_INTEREST` \| `PAYMENT_PENALTY` |
| `debitAccountId` / `creditAccountId` | String | FK → `Account.id` each | |
| `createdAt` / `updatedAt` | DateTime | | |

`@@unique([tenantId, sourceType, sourceId, transactionKind])` — re-submitting the same key is an
edit-in-place, not a duplicate to reject.

### 3.13 `JournalEntry` / `JournalLine` — posting engine

Every Savings/Loans transaction attempts to post here automatically
(`lib/journal.ts`); a transaction still succeeds (200) even with no mapping — it just posts as
`UNPOSTED_MISSING_MAPPING` and can be fixed retroactively once a mapping is added (verified by
`config.test.ts`'s "flips a deposit's journal entry from `UNPOSTED_MISSING_MAPPING` to `POSTED`"
test).

| `JournalEntry` column | Type | Notes |
|---|---|---|
| `id` | String PK | |
| `tenantId` | FK → `Tenant.id`, `onDelete: Cascade` | |
| `entryDate` | DateTime | |
| `sourceType` | `JournalSourceType` | `SAVING_TRANSACTION` \| `LOAN_PAYMENT` \| `LOAN_DISBURSEMENT` \| `MANUAL` |
| `sourceId` | String? | The `SavingTransaction`/`LoanPayment`/`Loan` id, null for `MANUAL` |
| `description` | String | |
| `status` | `JournalEntryStatus` | `POSTED` \| `UNPOSTED_MISSING_MAPPING` |
| `createdAt` | DateTime | |

`JournalLine` — one row per debit or credit leg (`debit`/`credit` are both `Decimal(15,2)`,
default `0`; exactly one is non-zero per line). A balanced entry's lines sum debit = sum credit;
`ErrorCode.JOURNAL_ENTRY_UNBALANCED` exists for the case where they don't, though no code path
currently produces an unbalanced entry.

### 3.14 `ShuDistributionConfig` / `CalkNarrative`

**`ShuDistributionConfig`** — one row per tenant (1:1), the SHU allocation formula.

| Column | Type | Notes |
|---|---|---|
| `id` | String PK | |
| `tenantId` | String, **unique**, FK → `Tenant.id`, `onDelete: Cascade` | |
| `jasaSimpananPercent` / `jasaPinjamanPercent` / `cadanganPercent` / `lainnyaPercent` | Decimal(5,2) | Must sum to 100 — application-validated (Zod `refine`), not a DB `CHECK` |
| `updatedAt` | DateTime | |

**`CalkNarrative`** — fixed narrative text sections for CALK (Catatan Atas Laporan Keuangan),
edited once by the tenant and reused every reporting period (the numeric parts of CALK are
computed on demand from `Account`/`JournalLine`, not stored).

| Column | Type | Notes |
|---|---|---|
| `id` | String PK | |
| `tenantId` | FK → `Tenant.id`, `onDelete: Cascade` | |
| `section` | `CalkSection` | `UMUM` \| `DASAR_PENYUSUNAN` \| `KEBIJAKAN_AKUNTANSI` \| `INFORMASI_TAMBAHAN` |
| `content` | String `@db.Text` | |
| `updatedAt` | DateTime | |

`@@unique([tenantId, section])` — one narrative per section per tenant.

## 4. Full-schema entity list

| Table | Purpose | Status |
|---|---|---|
| `SubscriptionPackage` | SaaS package tenants can be assigned | Implemented (CRUD + entitlement gate) |
| `Tenant` | Cooperative / SaaS tenant | Implemented |
| `CooperativeUnit` | Business line within a tenant | Implemented |
| `UnitMembership` | Member ↔ unit join | Implemented |
| `Role` | Tenant-scoped fine-grained RBAC | Implemented |
| `User` | Login identity (staff + platform admins) | Implemented |
| `Member` | Koperasi membership identity (no login) | Implemented |
| `SavingConfig` | Savings product definition | Implemented |
| `WhitelabelConfig` | Tenant branding/custom-domain config | Implemented |
| `Notification` / `NotificationRead` | Platform-admin in-app notifications | Schema only — seeded, no route consumes it |
| `Saving` | Member's savings balance | Implemented |
| `SavingTransaction` | Savings deposit/withdrawal ledger | Implemented |
| `LoanConfig` | Loan product definition | Implemented |
| `Loan` | Member's loan | Implemented |
| `LoanPayment` | Loan repayment ledger | Implemented |
| `Account` | Chart of Accounts | Implemented (accounting-entitlement gated) |
| `AccountMapping` | Transaction-kind → account routing | Implemented (accounting-entitlement gated) |
| `JournalEntry` / `JournalLine` | Double-entry posting engine | Implemented |
| `ShuDistributionConfig` | SHU allocation formula | Implemented (accounting-entitlement gated) |
| `CalkNarrative` | CALK narrative text | Implemented (accounting-entitlement gated) |

22 models total. Every one above has at least one Prisma migration applied and at least one
backend test exercising it (`apps/backend/tests/*.test.ts`) — see
`docs/02-System-Requirements-SISKOP.md` for the requirement-level traceability.

## 5. Configuration

Backend reads these environment variables (`apps/backend/.env.example`):

| Variable | Purpose | Dev default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://postgres:postgres@localhost:5433/siskop_dev` |
| `JWT_SECRET` | Access token signing key | *(must be set — no fallback)* |
| `JWT_REFRESH_SECRET` | Refresh token signing key | *(must be set — no fallback)* |
| `JWT_EXPIRES_IN` | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `7d` (code default, not in `.env.example`) |
| `NODE_ENV` | | `development` |
| `PORT` | Backend listen port | `3001` |
| `CORS_ORIGIN` | Allowed origin(s), comma-separated | `http://localhost:3000` |
| `LOG_LEVEL` | | `debug` |
| `STORAGE_PATH` | KTP-photo/logo upload directory | `./uploads` |

`apps/backend/.env.test` points `DATABASE_URL` at `siskop_test`, a separate database created
manually (`CREATE DATABASE siskop_test` + `prisma migrate deploy`) so integration tests — which
truncate tables between runs — never touch `siskop_dev`. Note the refresh token is **stateless**
(a signed JWT, not a DB row) — there is no `RefreshToken` table, a deliberate trade-off (see
`docs/04-System-Architecture-SISKOP.md` §6), not an oversight.

## 6. Related documents

- `docs/03-ERD-SISKOP.md` — visual entity-relationship diagram and cardinality summary
- `docs/04-System-Architecture-SISKOP.md` §7 — how this schema is used at the query layer
- `docs/02-System-Requirements-SISKOP.md` — functional requirements each table supports
- `apps/backend/prisma/schema.prisma` — source of truth
