# 01 — Product Requirements Document (PRD): SISKOP (v4)

Status: living document, updated **2026-09-29** against `main`@`0154f9c`. Owner: Product Manager
(see `docs/claude-integration/PM-INSTRUCTIONS.md`). Engineer, QA, and Ops co-sign their sections per
the team model in `CLAUDE.md`. **v4 is kept as a separate file from `docs/01-PRD-SISKOP-v3.md`**
(2026-09-12), following the convention v2 and v3 set. The 109 commits since v3 add a whole product
line (Koperasi Pasar), a regulatory capital model, central login, member self-registration, an
audit trail and a daily scheduler, so the change is large enough to diff against. v1–v3 are retained
for history only; treat this file as authoritative going forward.

Unlike v2/v3, which described mostly deltas and pointed back to v1 for "unchanged" sections, **v4
restates the full feature set** (§5) so that one file describes the product as it exists today.

## What changed since v3 (2026-09-12)

1. **Koperasi Pasar (KOPPAS) MVP shipped** (PR #45, plan `docs/2026-09-26-koperasi-pasar-dev-plan.md`
   phases F0–F7). It adds daily and weekly installment loans with a real per-installment schedule, an
   operating calendar, market/stall management, kiosk rent (sewa) and daily levies (retribusi),
   Kolektor (field collector) batches with verification, a mobile Kolektor screen, and pasar
   reports and dashboard widgets. F3–F7 are gated behind a new paid `pasar` package module. See §5.8–5.10.
2. **Regulatory capital model** (PR #40). Modal Sendiri is now derived from the ledger via equity
   classes (Permenkop UKM 8/2023 Pasal 1 angka 23–24). It feeds a new **BMPP** loan-concentration
   check (Pasal 44–45: 10% for related parties, 15% for other members; per-unit basis for KSU), the new
   **Laporan Perubahan Ekuitas**, Modal Sendiri lines in Neraca/CALK, and capital/loan-quality/
   growth dashboard insights. See §5.13–5.14.
3. **Central login and tenant selection** (PRs #25, #26, #30). Staff sign in once on the central
   site, pick a koperasi if they belong to several, and are handed off to that tenant's host through a
   one-use, browser-bound code. Members get the same from `/anggota/login` by NIK and password. The
   tenant is still never named by the caller (`CLAUDE.md` rule 1). See §3.
4. **Tenant addresses** (PR #18). Every tenant has a subdomain under
   `koperasi.inovasijayakarsa.id`. Packages with `customSubdomainEnabled` can rename it once per 365
   days, and old names keep redirecting. Each tenant's frontend is published through Firebase App
   Hosting. See §4.2.
5. **Member self-registration via QR** (PRs #27, #31). A public `/daftar/:tenantSlug` form (KTP upload,
   magic-byte file check, NIK masking, rate limit) feeds a staff review queue with approve/reject and a
   notification bell. The Cloudflare Turnstile CAPTCHA was added then **removed** (#31), so the rate
   limit is now the only abuse control. See §5.3.
6. **Daily scheduler** (PRs #15, #17). `POST /api/scheduler/run-daily` is triggered by Cloud
   Scheduler. It accrues DAILY savings interest, recalculates loan KOL, checks the audit threshold,
   purges audit logs older than 90 days, and generates pasar charges. See §5.18.
7. **Audit trail** (PR #41). User activity (auth, members, savings, loans, roles, units, calendar, pasar,
   collections) is recorded with 90-day retention and surfaced in a **Jejak Audit** tab. See §5.16.
8. **Beban Umum** (general expense entry, PR #44). An ungated page that posts a cash/bank expense
   straight to the journal. It required auto-generating the standard COA for **every** new tenant at
   provisioning. See §5.11.
9. **Accounting completeness** (PR #33). Toko sales, HPP and restocks now reach the ledger for every
   tenant, not just the demo seed. `JournalEntry.unitId` enables per-unit Neraca/Laba Rugi/Arus Kas.
   Unposted entries can be re-posted from a banner once a mapping exists. **Laporan Toko** was added.
   See §5.7, §5.12.
10. **Savings UX** (PRs #36, #39). Riwayat Transaksi is now a bank-statement ("Rekening Koran") view
    with opening/closing balance and PDF/CSV export, and the savings list is grouped by member.
11. **Kredit Anggota / Piutang Anggota is on `main`.** v3 §9.3 item 11 is resolved. See §5.7.
12. **D7 (regulatory-report date boundary) is fixed** (`def298e`): date ranges now resolve against
    Asia/Jakarta business days. **D1–D3 and D6 remain open.** The Setoran Awal fix (PR #37) merged
    only its plan document, not the code. See §8.1.

## 1. Problem statement

Indonesian cooperatives (koperasi) need multi-unit consolidation, SHU distribution, regulatory
reporting, and member self-service that spreadsheets and single-tenant desktop software don't
provide. That covers savings-and-loan (KSP), consumer (Konsumen/Toko), producer, service, marketing,
multi-unit combinations (koperasi serba usaha, KSU) and, new in v4, **market cooperatives (Koperasi
Pasar)** that run a traditional market and lend to its traders. A SaaS vendor also needs strict tenant
isolation to serve many cooperatives from one system.

SISKOP is that multi-tenant SaaS platform. A cooperative can discover, register for and pay for
SISKOP self-service (§5.1), or be provisioned by a platform operator (§5.2).

## 2. Goals

Product goals, carried from `docs/claude-integration/PM-INSTRUCTIONS.md` — unchanged:

| Goal | Target |
|---|---|
| Tenant adoption | 50 koperasi onboarded |
| Customer satisfaction | NPS ≥ 7 |
| Platform availability | 99.5% uptime |
| Dashboard responsiveness | < 3s load |
| API responsiveness | < 500ms (p99) — login not re-measured since v2, see §8.1 D5 |

Non-goals for the current phase:

- Recurring/automated subscription billing, refunds, dunning, automatic expiry enforcement — unchanged
  from v3. Xendit collects one payment per registration. `nextBillingDate` now has one reader
  (address-change eligibility, §4.2), but nothing re-charges or deactivates a lapsed tenant.
- Native app-store distribution — unchanged. Both mobile surfaces are responsive web.
- **Offline collection** (new): the Kolektor screen is online-only by decision; saving is disabled
  offline (pasar plan F6).
- **Automatic late penalties** (new): loan `penalty` stays a manual input (pasar decision D7).
- A real PPOB biller integration — PPOB is still a simulated stub (§5.7).
- Government/regulatory e-filing integration; multi-currency (Rupiah only) — unchanged.

## 3. Users, identities and roles

### 3.1 Identities

| Identity | How it signs in | Notes |
|---|---|---|
| Staff `User` (Firebase) | Google or email/password via Firebase, on the central site or a tenant host | Created by paid onboarding or invitation. Looked up by `firebaseUid`, never by email. |
| Staff `User` (legacy) | Email + password on the tenant's `/login/legacy` | Platform-provisioned or legacy-registered accounts. |
| Platform admin | `User.isPlatformAdmin = true`, central site | Manages tenants, packages, platform admins. |
| Member (Anggota) | NIK + password on `/anggota/login` (central or tenant host) | Separate auth system. Portal access is activated by staff; the default password is derived from the birth date and must be changed on first login (see D6). |

**Central staff login** (PRs #25/#26/#30, `docs/tenant-login-selection-plan.md`): a staff person with
memberships in several koperasi sees a selection modal; a single membership redirects directly. The
session is handed to the canonical tenant host by a one-use code bound to the destination browser,
and a dashboard switcher lets a person move between their koperasi.

**Central member login** (`docs/member-login-selection.md`): `/anggota/login` searches memberships by exact
NIK and verifies **each membership's own password** before showing any tenant option. It uses a
5-minute HttpOnly selection cookie, a 60-second fragment code, and per-NIK and per-IP rate limits.
Portal tokens are issued only at the tenant host.

### 3.2 Roles

Every tenant is seeded with six roles (`apps/backend/src/modules/tenants/provision.ts`). Tenants can
create custom roles. Permissions are per module × action (`create/read/update/delete/export`).

| Role | Scope |
|---|---|
| Super Admin | Everything in the tenant |
| Manager | Operations incl. product/SKU management, Kolektor assignment, batch verification |
| Teller | Front counter: savings/loan transactions, POS sales, stock movements, verifies Kolektor batches |
| Viewer | Read-only |
| Kasir | Toko/POS only (`konsumen`), restricted to assigned units |
| Kolektor | Records collections for their own assigned members (binaan) only; cannot verify own batch |

Permission modules: `dashboard, members, savings, loans, reports, config, users, roles, accounting,
konsumen, auditLog, expenses, market, collections` (`packages/types/src/role.ts`). A separate coarse
`AuthClaims.role` (super_admin/tenant_admin/accountant/member) still drives platform and unit-access
gating.

## 4. Core product concepts

### 4.1 Tenant, unit and KSU

A tenant is one koperasi with ≥1 `CooperativeUnit` (types: KSP, KONSUMEN, PRODUSEN, JASA,
PEMASARAN). **KSU is `units.length > 1`**, never a stored type (`CLAUDE.md` rule 2b). Financial rows
carry `unitId`; `JournalEntry.unitId` is nullable for the tenant-level "unallocated" bucket, so
per-unit figures plus unallocated always equal the consolidated figure. Staff can be scoped to specific
units. A tenant is `KONVENSIONAL` or `SYARIAH`; loan pricing supports `BUNGA`, `BAGI_HASIL`, `MARGIN`
and `HARIAN`.

### 4.2 Tenant addressing

- Tenants live at `<slug>.koperasi.inovasijayakarsa.id`. The tenant is resolved from `Host`
  (`slugFromHost`), never from request input. A tenant's permanent identity is `Tenant.id`; the slug is
  only its address.
- Paid registration generates a slug from the koperasi name plus a random suffix. An unpaid koperasi
  cannot use its tenant site.
- **Address change** (Konfigurasi → Alamat Workspace): only for packages with
  `customSubdomainEnabled` and an unexpired `nextBillingDate`. It requires `config.update` and a fresh
  Firebase login, and is allowed once per 365 days. Old names stay reserved for that tenant and redirect.
  There is no admin cooldown bypass.
- Registration, checkout, payment callbacks and platform admin stay on the central site.

### 4.3 Platform vs. tenant separation

Unchanged from v1: platform administration (tenants, packages, platform admins) is a separate surface
from tenant operations, and every tenant query filters by `req.auth.tenantId`. A Prisma tenant-scope
guard enforces this on registered tenant models.

## 5. Feature catalogue

Status column in §6. "Gated" means a package entitlement is required (§7).

### 5.1 Public landing page and paid onboarding
Landing page → package selection (`/register?package=<id>`) → Firebase sign-up → Xendit payment link →
tenant activation, confirmed by webhook with server-side re-fetch and exact Decimal amount check.
Registration provisions the tenant, admin user, first unit, seeded roles, **standard COA and default
mappings** and an order atomically; the tenant stays inactive until paid. Only active,
positive-whole-rupiah packages are offered. The flow degrades gracefully when Xendit/Firebase are
unconfigured. Legacy `POST /api/auth/register` is disabled in production.

### 5.2 Platform Admin
Tenant list, provisioning and package assignment (including `nextBillingDate`), subscription package CRUD
(modules, quotas, `whitelabelEnabled`, `customSubdomainEnabled`), platform-admin user CRUD, identity
reconciliation. Platform notifications: `TENANT_REGISTERED`, `BILLING_BLOCKED`, `PACKAGE_CHANGED`.

### 5.3 Members (Anggota)
- Member CRUD with NIK, auto-generated member ID and account number; deactivation; unit memberships.
- **Self-registration via QR**: staff enable it in Konfigurasi, generate a QR/link to the public
  `/daftar/:tenantSlug` form. Submissions include a KTP upload (magic-byte checked), are rate-limited
  (5/hour/IP by default), mask NIK in responses, and return an identical 404 for unknown or disabled
  tenants. Staff review them in the "Pendaftaran Mandiri" tab. Approval requires viewing the KTP and
  creates the member atomically. Rejection records a reason. A notification bell alerts staff to
  pending requests.
- Member portal activation/reset by staff.

### 5.4 Savings (Simpanan)
- Products (`SavingConfig`) of type Pokok, Wajib or Sukarela, with configurable interest rate (≤9%/yr
  regulatory cap) and period, including **DAILY** interest accrued by the scheduler and posted to the journal.
- Deposit, withdrawal, interest (`INTEREST` transaction type). Pokok cannot be withdrawn while the
  member has an active loan.
- **Rekening Koran** statement: period filter (≤366 days), Saldo Awal / Debit / Kredit / Saldo Akhir,
  PDF and CSV export. Available in the staff web app, staff mobile and the member portal.
- Savings list grouped by member.
- Known gaps: D1–D3 (§8.1). Pokok/Wajib have no fixed AD/ART nominal yet
  (`docs/2026-09-25-setoran-awal-fix-plan.md`, unimplemented).

### 5.5 Loans (Pinjaman / Pembiayaan)
- Loan products and loans per unit (explicit `unitId`). Conventional and syariah types. Requires an
  active Pokok saving.
- **Installment frequency** DAILY, WEEKLY or MONTHLY, with a persisted per-installment schedule that skips
  closed weekdays and tenant holidays, shifting a due date to the next operating day. Optional rounding up
  to a Rp500 multiple, with the last installment taking the remainder.
- **Rate override**: staff may change the product's default rate per loan (≤24%/yr cap), but must enter
  a `rateNote`. The change is audit-logged.
- Payments are computed in `Decimal` end to end and allocated across installments. Penalty is manual.
- **KOL** (Lancar, Dalam Perhatian, Kurang Lancar, Diragukan, Macet) is computed from the oldest unpaid
  installment and recalculated daily. There is an overdue list.
- **BMPP** (Permenkop UKM 8/2023 Pasal 44–45): the member's active principal plus the new loan is
  measured against a percentage of Modal Sendiri.
  - **10% for related parties** (pengurus/pengawas) is a **hard block**. With zero Modal Sendiri,
    a related party cannot borrow at all.
  - **15% for other members** is a **confirmable warning** (`acknowledgeBmpp`). It applies only once
    Modal Sendiri is greater than 0.
  - A single-unit koperasi measures against consolidated Modal Sendiri and all of the member's active
    loans; a KSU uses the lending unit's own Modal Sendiri and loans. The headroom is shown on the
    loan form.
- An idempotent backfill built schedules for pre-existing loans.

### 5.6 Collections (Kolektor) — gated `pasar`
- Manager assigns members (binaan) to a Kolektor.
- `GET /today` shows each binaan's due installments, daily saving, and sewa/retribusi charges, with
  pasar/blok/kiosk code.
- Kolektor records deposits, loan payments and charge payments. Writes carry an **Idempotency-Key**, so
  retries don't double-post. Cash posts to a `COLLECTOR_CASH` account until verified.
- Batch lifecycle: **OPEN → SUBMITTED → VERIFIED**. Teller or Manager verifies; a Kolektor cannot verify their
  own batch. Every step is audit-logged.
- Mobile "Setoran Hari Ini" screen (online-only).

### 5.7 Konsumen: Toko, POS, PPOB, Kredit Anggota
- Products and stock movements. A restock (`IN`) posts Dr Persediaan / Cr Kas at cost; an adjustment
  sets the count and is not journaled.
- POS sale: decrements stock and posts sales, HPP, and inventory. Posting is all-or-nothing, so a
  half-mapped sale stays unposted rather than posting a lopsided entry.
- **Kredit Anggota**: a member pays on store credit up to **50% of total active savings**, recomputed on
  every read. The sale debits Piutang Anggota (Toko). A tenant-wide **Piutang Anggota** page lists
  balances and records repayments (Dr Kas / Cr Piutang).
- **Laporan Toko** (`GET /api/konsumen/reports/sales`, `reports:read`): omzet, HPP, margin. A contract
  test ties it to Laba Rugi.
- **PPOB**: check-and-pay flow against a **simulated biller** (stub; no real provider).
- Kasir role scoped to assigned units, re-checked on every request.

### 5.8 Koperasi Pasar: markets and stalls — gated `pasar`
Market master data, stalls of kind **Kios / Los / Lapak** with status, trader (pedagang) profile.
Audit-logged create/update.

### 5.9 Koperasi Pasar: sewa and retribusi — gated `pasar`
- Rent contracts per stall/trader; levy rates.
- Charges of kind **SEWA** or **RETRIBUSI** with a DAILY, MONTHLY or YEARLY period. The daily scheduler
  generates them on operating days only.
- Accrual and payment journal entries. Retribusi is **cooperative revenue** (Pendapatan Retribusi),
  not a liability (decision D5).
- Payment at the counter or by a Kolektor.

### 5.10 Operating calendar
Tenant-configurable closed weekdays (default: Sunday) and holidays (manual or imported). Used by
loan schedules and charge generation. Audit-logged.

### 5.11 Beban Umum (general expenses) — ungated
Standalone page: record an expense against a BEBAN account, credited to a cash-equivalent (Kas/Bank)
account, optionally attributed to one unit (default: unallocated). There is delete but no edit.
Posts `MANUAL_EXPENSE` journal entries. Permission module `expenses`.

### 5.12 Accounting and ledger — gated `accounting` (COA/mapping screens)
- Chart of Accounts with category, normal balance, cash-equivalent flag, and **equity class**
  (Simpanan Pokok, Simpanan Wajib, Modal Tetap, Cadangan Umum, Cadangan Risiko, Hibah, Modal
  Penyertaan, SHU, Ekuitas Lain).
- The standard COA and default mappings are **auto-generated at provisioning**. A one-click
  "Generate Standard COA" is idempotent for later additions.
- Account mappings per transaction kind (savings, interest, loans, POS sale/HPP/receivable/restock,
  member-credit repayment, collector cash, sewa/retribusi, expenses).
- Automatic balanced journal entries from every financial flow, plus manual entries. **Unposted-entry
  banner** with re-post once a missing mapping is added.
- Journal posting itself is ungated: a base tenant's transactions post through the auto-provisioned
  COA even though it cannot open the COA/mapping screens or regulatory reports.

### 5.13 Capital: Modal Sendiri, Modal Disetor, audit threshold
- **Modal Sendiri** is derived from the ledger by equity class, as of any date, consolidated or per unit.
  It includes Simpanan Pokok, Simpanan Wajib, Modal Tetap, Cadangan Umum, Cadangan Risiko and Hibah,
  and excludes Modal Penyertaan, unallocated SHU and other equity. Manual adjustment is possible.
- **Modal Disetor** config. The daily **audit-threshold** check (Permenkop UKM 2/2024 Pasal 12:
  Rp5 miliar) is judged on **Modal Sendiri from the ledger**, not on the Modal Disetor figure, and
  only for tenants with an active KSP unit. It sends "exceeded" if Modal Sendiri at the previous
  31 December reached the threshold, otherwise "approaching" if the running year's figure has. Each
  notification is sent at most once per year. This is a reminder only, never enforced.

### 5.14 Reports
- **Operational** (ungated): savings, loans, overdue, member reports. PDF export.
- **Regulatory / financial** (gated `accounting`): Neraca, Laba Rugi (Hasil Usaha), Arus Kas,
  **Laporan Perubahan Ekuitas**, CALK, Distribusi SHU (per SHU config). Period range controls. Neraca,
  Laba Rugi and Arus Kas support a per-unit filter; SHU and CALK are cooperative-level. Modal Sendiri
  and its composition appear in Neraca/CALK. Date ranges resolve against **Asia/Jakarta** business
  days. PDF export.
- **KSU** (gated `accounting`): consolidated asset report (with unallocated remainder), per-unit
  member SHU statement, unit segregation view.
- **Laporan Pasar** (gated `pasar`): rekap kolektor, tunggakan angsuran, tunggakan sewa/retribusi, with
  CSV export.

### 5.15 Dashboard
- Summary KPIs (per unit or consolidated), loan disbursement and payment charts.
- **Health section**: capital structure and Modal Sendiri trend, loan quality by KOL, and member/asset
  growth.
- Pasar widgets (gated): today's collections, unverified batches, arrears.
- System date shown under the account name in the header.
- The capital/loan-quality/growth insights landed as "(WIP)" (`53d1c2b`). QA acceptance is still pending.

### 5.16 Audit trail (Jejak Audit)
Records auth (login success/failure), member, saving, loan, role, unit, calendar, market/stall,
collector assignment and batch, and charge-payment actions with actor and tenant. Read-only
`auditLog:read` tab in Konfigurasi. **90-day retention**, purged daily. Rows are never user-editable.

### 5.17 Configuration (Konfigurasi)
Tabs: Unit Usaha, Peran (roles), Pengguna (users), Bagan Akun, Pemetaan Akun, Produk Simpanan, Produk
Pinjaman, Konfigurasi SHU, Modal Disetor, Kalender Operasional, Pendaftaran Mandiri, White-label
(gated), Alamat Workspace (gated by package capability), Jejak Audit.

### 5.18 Daily scheduler
Cloud Scheduler calls `POST /api/scheduler/run-daily` (shared-secret `x-scheduler-token`). An in-process
cron also exists for local/single-instance use. The jobs run independently, so one failure doesn't
block the others:

1. DAILY savings interest accrual. It is idempotent via `Saving.lastInterestAt`, catches up missed days, and
   never back-fills to account creation.
2. KOL recalculation for all loans.
3. Modal Disetor audit-threshold check.
4. Audit-log purge (> 90 days).
5. Sewa/retribusi charge generation.

### 5.19 Notifications
Tenant notifications (permission-scoped bell): self-registration requests and audit threshold.
Platform notifications as in §5.2. In-app only; email is used for registration confirmation (Resend).

### 5.20 Mobile (responsive web, `apps/mobile`)
- **Staff**: dashboard, members, savings, loans, overdue, reports incl. regulatory; **Kolektor
  "Setoran Hari Ini"**.
- **Member portal**: login/handoff/tenant selection, forced password change, dashboard, savings with
  Rekening Koran, loans, profile. Read-only.

## 6. Module status

| Module | Status | Evidence |
|---|---|---|
| Onboarding (public, paid) | Implemented | `modules/onboarding/`, `features/onboarding/` |
| Tenant provisioning (+ auto COA) | Implemented | `modules/tenants/provision.ts` |
| Tenant addressing / domains | Implemented; hosted rollout partially verified (see plan doc) | `modules/tenant-domains/`, `infra/tenant-web/` |
| Auth (staff) + central selection | Implemented; hosted Google login E2E pending | `modules/auth/`, `modules/tenant-access/`, `modules/identity-provisioning/` |
| Member auth + central selection | Implemented — **D6 open** | `modules/member-auth/`, `modules/member-access/` |
| Platform Admin | Implemented | `modules/platform/` |
| Members + self-registration | Implemented | `modules/members/` |
| Savings | Implemented — **D1–D3 open, release-blocking** | `modules/savings/` |
| Loans (schedules, BMPP, KOL) | Implemented | `modules/loans/`, `lib/installment-schedule.ts` |
| Collections (Kolektor) | Implemented, gated `pasar` | `modules/collections/` |
| Market (stalls, sewa, retribusi) | Implemented, gated `pasar` | `modules/market/` |
| Konsumen (Toko/POS/Kredit Anggota) | Implemented | `modules/konsumen/` |
| PPOB | **Stub** (simulated biller) | `modules/konsumen/ppob.service.ts` |
| Beban Umum | Implemented | `modules/expenses/` |
| Accounting / ledger | Implemented | `lib/journal.ts`, `modules/config/` |
| Capital (Modal Sendiri, audit threshold) | Implemented | `modules/reports/capital-service.ts`, `modules/config/audit-threshold.ts` |
| Reports (financial, regulatory, KSU, pasar) | Implemented; D7 fixed | `modules/reports/`, `modules/ksu/` |
| Dashboard | Implemented; health insights awaiting QA acceptance | `modules/dashboard/` |
| Audit trail | Implemented | `modules/audit-log/` |
| Scheduler | Implemented | `modules/scheduler/` |
| Notifications | Implemented (in-app) | `modules/notifications/` |
| Mobile — staff + Kolektor | Implemented | `apps/mobile/src/pages/` |
| Mobile — member portal | Implemented — **D6 open** | `apps/mobile/src/pages/member/` |

## 7. Subscription and entitlement model

`SubscriptionPackage` fields: `price` (Decimal), `modules[]`, `maxUsers`, `maxMembers`,
`maxSavingConfigs`, `whitelabelEnabled`, `customSubdomainEnabled`.

| Capability | Gate | Covers |
|---|---|---|
| Base | none | Dashboard, Members, Savings, Loans (incl. schedules/KOL/BMPP), Konsumen, operational reports, Beban Umum, Kalender, Audit trail |
| `accounting` module | `requireAccountingEntitlement` | COA (incl. generate-standard), account mappings, unposted-journal re-post, SHU config, regulatory/financial reports, KSU consolidated/SHU-statement reports |
| `pasar` module (new) | `requirePasarEntitlement` | Markets/stalls, contracts, levy rates, charges, Kolektor, Laporan Pasar, pasar dashboard widgets |
| `whitelabelEnabled` | `requireWhitelabelEntitlement` | Logo/colour branding |
| `customSubdomainEnabled` (new) | tenant-domains service | Address change (§4.2) |

Still true from v3: **quotas (`maxUsers`, `maxMembers`, `maxSavingConfigs`) are not enforced** when
users, members or saving products are created. They are only read in `platform/` and `onboarding/`.
Payment is one-time per registration. Package upgrades are done by a platform admin; there is no
upgrade checkout.

## 8. Non-functional requirements

- **Performance**: API p99 < 500ms, dashboard < 3s, PDF < 10s. No load testing/APM exists; login
  latency (D5) not re-measured.
- **Availability and DR**: CI/CD deploys the backend to Cloud Run, per-tenant frontends to Firebase
  App Hosting, and the scheduler via Cloud Scheduler (`infra/firebase/`, `infra/tenant-web/`). Image
  retention is bounded with release digests protected. **Still missing**: database backup, tested
  restore, documented RTO (< 1h) / RPO (< 15min).
- **Isolation**: every tenant query is filtered by `req.auth.tenantId`, backed by a Prisma tenant-scope
  guard. Cross-tenant sweeps (scheduler, audit purge) are explicit, documented exceptions.
- **Money**: always `Decimal`. The loan payment path was converted end to end (`3c60b66`). One remaining
  `number` constant, `CREDIT_LIMIT_RATIO = 0.5`, is a ratio, not an amount.
- **Idempotency**: Kolektor writes (Idempotency-Key), interest accrual (`lastInterestAt`), charge
  generation, and COA generation are all safe to retry.
- **Abuse controls**: rate limits on public registration, onboarding, and member login. The limiter
  store is process-local, a known gap for multi-instance deployment. There is no CAPTCHA on
  self-registration since #31.
- **Tests**: backend has 90 test files and about 930 `it`/`test` cases, counted statically on 2026-09-29.
  The last recorded full run was 559/559 passing with **95.71% line coverage** (PR #27, 2026-09-16),
  above the 80% gate. **The suite was not re-run for this revision** (local Postgres unavailable), and
  the pasar and capital work landed after that recorded run. Frontend and mobile have only one test file
  between them (NFR-TEST-07 still effectively open).

### 8.1 QA status

**Scope note**: this is a 2026-09-29 re-verification by reading code on `main`, not a formal QA
cycle. No QA Cycle 3 has run against Konsumen, onboarding, central login, self-registration, or Pasar.

| ID | Severity | Status | Module | Summary |
|---|---|---|---|---|
| D1 | P0 | **Still open** | Savings | `createSaving()` never checks for an existing Pokok. `hasPokokSaving()` is only called from `createLoan()`. |
| D2 | P0 | **Still open** | Savings | Pokok withdrawal guards only "no active loan". There is no floor/never-zero rule (`savings/service.ts` ~L413). |
| D3 | P0 | **Still open** | Savings | `Saving` has no `@@unique(memberId, unitId, savingConfigId)` and no app-level duplicate check. |
| D4 | P1 | Still open, low exposure | Auth | Legacy `registerTenant()` relies on per-tenant `P2002` for admin email; the path is production-disabled. |
| D5 | P2 | Not re-measured | Auth/Perf | Login latency. |
| D6 | **P0** | **Still open, reframed** | Member portal | The server never checks `mustChangePassword`: `member-portal/routes.ts` gates only on `requireMemberAuth`. The forced change is enforced **only by the mobile client** (`MemberAppLayout.tsx`). The default password is now birth-date-derived, so anyone who knows a member's NIK and birth date can call the portal API directly without ever changing it. |
| D7 | — | **Fixed** (`def298e`) | Reports | Date ranges resolve against Asia/Jakarta. The regression test covers it. |

**New observations (not yet triaged by QA):**

- **O1**: The Setoran Awal plan (Pokok/Wajib fixed nominal; D1–D3 fixes) merged as a document only
  (PR #37). A zero-balance Pokok still satisfies the loan gate.
- **O2**: Self-registration lost its CAPTCHA (#31), so the only guard on the system's first
  unauthenticated write path is a process-local rate limit.
- **O3**: The dashboard health insights shipped labeled WIP and have no QA acceptance.

**Release recommendation: No-Go carries forward** for Savings and the member portal (D1–D3, D6).
Pasar, capital and central-login surfaces need a QA Cycle 3 pass before any release announcement.

## 9. Open product decisions

Resolved since v3:
- v3 #11 (Kredit Anggota unmerged) is resolved: it is on `main`.
- Koperasi Pasar decisions D1–D8 are all answered (pasar plan).

Still open, or new:
1. **Legacy unpaid registration** (v3 #10): confirm there is permanently no self-service unpaid/trial path.
2. **QA Cycle 3** (v3 #12): now even broader. It should cover Konsumen, onboarding, central login,
   self-registration, and all of Pasar.
3. **Savings rules** (new): ratify and schedule the Setoran Awal plan, or park it explicitly. It
   blocks D1–D3.
4. **Quota enforcement** (new): enforce `maxUsers`/`maxMembers`/`maxSavingConfigs`, or drop them
   from packages. Today they are sold but inert.
5. **Renewal billing** (new): `nextBillingDate` now affects address-change eligibility, but no
   renewal checkout exists. Decide what happens when a paid period lapses.
6. **Self-registration abuse control** (new): accept rate-limit-only, or restore CAPTCHA or
   another challenge.
7. **PPOB** (new): choose a real biller, or keep PPOB out of marketing until one exists.
8. **Audit-log retention** (new): 90 days may be short for koperasi audit cycles (annual RAT and
   public-accountant audit). Confirm against regulatory needs.

## 10. Success metrics and instrumentation gap

Unchanged: there is no metrics/analytics pipeline. The audit trail (§5.16) records user activity but is
not a product-analytics source and is purged after 90 days.

## 11. Related documents

- `docs/01-PRD-SISKOP-v3.md` (2026-09-12), `-v2.md` (2026-09-11), `01-PRD-SISKOP.md` (v1) — history
- `docs/02-System-Requirements-SISKOP.md` … `docs/09-QA-Test-Cases-SISKOP.md` — requirements, ERD,
  architecture, schema, QA plan and cases (Module 16 covers self-registration)
- `docs/2026-09-26-koperasi-pasar-dev-plan.md`, `docs/research/2026-09-26-koperasi-pasar-gap-mvp.md` — Pasar
- `docs/2026-09-27-beban-umum-design.md`, `docs/2026-09-27-beban-umum-plan.md` — Beban Umum
- `docs/2026-09-25-setoran-awal-fix-plan.md` — unimplemented savings fix plan
- `docs/SISKOP-Formula-List.xlsx` — every business formula (savings, loans, BMPP, KOL, SHU, capital,
  pasar) with its source file, a live calculator, regulatory parameters, and journal patterns
- `docs/tenant-domains.md`, `docs/tenant-domain-dns.md`, `docs/tenant-domain-verification.md`,
  `docs/tenant-login-selection-plan.md`, `docs/member-login-selection.md` — addressing and login
- `docs/landing-page/README.md`, `infra/firebase/README.md` — onboarding, payment, deploy
- `docs/claude-integration/PM-INSTRUCTIONS.md` — PM decision authority and targets
