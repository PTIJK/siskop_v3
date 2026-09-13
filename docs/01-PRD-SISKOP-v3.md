# 01 — Product Requirements Document (PRD): SISKOP (v3)

Status: living document, updated **2026-09-12** against the current codebase. Owner: Product
Manager (see `docs/claude-integration/PM-INSTRUCTIONS.md`). Engineer, QA, and Ops co-sign their
sections per the team model in `CLAUDE.md`. **v3 of this document — kept as a separate file from
`docs/01-PRD-SISKOP-v2.md` ("v2", dated 2026-09-11) rather than overwriting it**, following the same
convention v2 set relative to v1: the change since v2 (KSU/Konsumen going from "unmerged spike" to
released on `main`, a public paid-onboarding flow with a real payment gateway, a CI/CD deploy
pipeline, and a new in-progress member-credit feature) is large enough to diff against. v1 and v2
are both retained for history only; treat this file as authoritative going forward.

## What changed since v2 (2026-09-11)

1. **KSU/Konsumen (Toko-POS) MVP is now merged to `main` and released**, reversing v2 §4b/§2's
   framing of it as an unmerged spike. Commit `89cd7e3` ("merge: fold in KSU/Konsumen (Toko-POS) MVP
   spike + Kasir RBAC") plus PR #3 (`integration/ksu-toko-landing`, `a0057fe`) brought in
   `feature/ksu-mvp-week1-spike`, `feature/ksu-mvp-full-stack`, and `feature/toko-rbac-unit-scoping`
   as described in v2 §4b — consolidated cross-unit reporting, per-unit member SHU statements, the
   full Konsumen POS module (`Product`/`POSSale`/`StockMovement`/`PPOBTransaction`, additive schema),
   a PPOB check-and-pay skeleton against a simulated biller, and the Toko-only Kasir role. SD-001 (the
   "Jan 2027 KSU engineering start") is superseded by this merge — treat it as executed, not just
   ratified. See §4b and §5.
2. **A public, self-service, paid onboarding flow shipped** (`e60539c`, PR #2 `feature/landingPage`,
   `7c304a3`), reversing v2 §2's "no payment gateway integration" non-goal. A visitor now reaches a
   marketing landing page, picks a paid package, authenticates via Firebase (Google or email/
   password), and pays through Xendit (`POST /sessions`, one-time monthly payment link, IDR) before
   the tenant activates. This is a **third, parallel identity axis** alongside staff `User`/password
   login and the NIK-based `Member` portal login from v2 §3 — Firebase-authenticated admins store no
   local password hash. See §3, §4c (new), §8.
3. **The legacy self-service tenant-registration endpoint (`POST /api/auth/register`) is now disabled
   by default in production.** `apps/backend/src/modules/auth/routes.ts:37` only allows it when
   `NODE_ENV === "test"`, or `NODE_ENV === "development"` with an explicit
   `ALLOW_LEGACY_REGISTRATION=true` override — never in production. New tenants now come from the
   paid onboarding flow (§4c) or Platform Admin's direct provisioning (`super_admin`, unchanged from
   v1 §4a). See §9.3 (new).
4. **A CI/CD deploy pipeline now exists**: PRs #7/#8 (`feature/cloud-build`, `72cc4b0`/`d50b432`) wire
   `main` to deploy the backend to Cloud Run and the frontend to Firebase Hosting on push
   (`infra/firebase/cloudbuild.yaml`, `cloudbuild-release.yaml`). This narrows, but does not close, the
   v1/v2 NFR gap — deploy automation exists now, but no backup/restore, RTO/RPO, or DR tooling has
   been added (`infra/firebase/` has release/verify scripts, nothing for backups). See §7.
5. **Kredit Anggota (member store credit at POS) and a tenant-wide Piutang Anggota repayment screen
   were built** (`b4df7c6`, `1e09f81`, current branch `feature/piutang-anggota-toko`, **not yet merged
   to `main`**) — a member can now pay for a Toko sale on credit up to an auto-computed limit (50% of
   their total active savings balance, recomputed on every read, never stored), which debits a
   "Piutang Anggota (Toko)" receivable instead of Kas, plus a repayment flow that reverses it. See §4b,
   §5.
6. **Sidebar restructured, and a post-reload UI bug fixed** (`205bf2e`, `2d302d6`, same unmerged
   branch): navigation is now `Unit Usaha > KSP` (Simpanan/Pinjaman) and `Unit Usaha > Konsumen > Toko`
   for every tenant regardless of unit count (previously gated on `isMultiUnit`, which would have hidden
   Simpanan/Pinjaman navigation for the single-unit majority); and the app shell no longer blanks
   behind a spinner on a hard reload while the in-memory access token refreshes.
7. **D1-D6 from v2's QA Cycle 2 are all still open, re-confirmed 2026-09-12 by direct code
   inspection** (not a new formal QA cycle — see §7.1's note on scope). No fix has landed for any of
   them since `4c46ee0`.
8. **A new, currently-reproducible defect (D7) was found today** re-running the automated backend
   suite: a regulatory-report date-boundary bug — the same bug *class* v1-era memory calls out as
   previously fixed via `endOfDay()` — has resurfaced in a different form. See §7.1.
9. **Backend automated test count grew substantially**: 412/413 tests passing across 36 files (up
   from v2's 233/18), reflecting the KSU/Konsumen/onboarding merges. See §5, §7.1 D7 for the one
   failure.

## 1. Problem statement

Unchanged from v2. Indonesian cooperatives (koperasi) — savings-and-loan (KSP), consumer (Konsumen),
producer (Produsen), service (Jasa), marketing (Pemasaran), and multi-unit combinations (koperasi
serba usaha, KSU) — need multi-branch consolidation, SHU distribution, and regulatory reporting that
spreadsheets and single-tenant desktop software don't provide, plus tenant isolation for a SaaS
vendor to serve many cooperatives from one system, plus member self-service. SISKOP is a multi-tenant
SaaS platform serving that need; as of this revision, a cooperative can also **discover, register for,
and pay for SISKOP itself entirely self-service**, through the public landing page (§4c) — onboarding
is no longer necessarily mediated by a platform operator provisioning tenants by hand.

## 2. Goals

Product goals, carried from `docs/claude-integration/PM-INSTRUCTIONS.md` — table unchanged from v2:

| Goal | Target |
|---|---|
| Tenant adoption | 50 koperasi onboarded |
| Customer satisfaction | NPS ≥ 7 |
| Platform availability | 99.5% uptime |
| Dashboard responsiveness | < 3s load |
| API responsiveness | < 500ms (p99) — **currently missed on login specifically, see §7.1 D5** |

Non-goals for the current phase — **two items reversed from v2**:

- ~~Payment gateway integration~~ **REVERSED**: Xendit now collects a real, one-time monthly payment
  for self-service package signup (§4c, §8). Still **not** implemented: recurring/automatic renewal
  billing, refunds, dunning, or automatic expiry enforcement when a paid period lapses — the
  onboarding README (`docs/landing-page/README.md` §"Payment behavior") is explicit that "renewal
  collection, reminders, refunds, and automatic expiry enforcement remain separate billing work."
- ~~Multi-unit (KSU) / Konsumen POS as a released feature~~ **REVERSED**: merged to `main` (§4b, §5).
- Mobile native apps (app-store distribution) — unchanged from v2; both mobile surfaces are
  responsive web, native/Capacitor packaging remains conditional and unscheduled.
- Government/regulatory e-filing integration — unchanged from v2.
- Multi-currency (Rupiah only) — unchanged from v1/v2.
- **New this revision**: recurring/automated subscription billing — Xendit collects one initial
  payment per registration only (§4c, §8); there is no scheduled job or dunning flow that charges a
  tenant again at renewal, despite `nextBillingDate` being stored.

## 3. Users and roles

Table unchanged from v2 (`super_admin` / `tenant_admin` / `accountant` / `member`-the-coarse-claim).
**New this revision**: a self-service-registered tenant admin's staff identity is now sometimes
Firebase-backed rather than password-backed —

- A `User` row created through the paid onboarding flow (§4c) carries `firebaseUid` +`authProvider`
  and **no `passwordHash`** — `apps/backend/src/modules/onboarding/service.ts`'s `register()`. Login
  for this identity is `firebaseSignIn()` (same file): it verifies the Firebase ID token, looks up the
  `User` by the globally-unique `firebaseUid` (never by email, and never by a client-supplied tenant),
  and only then resolves which tenant/session to grant — preserving the "tenant is never named by the
  caller" rule (`CLAUDE.md` #1) through a different mechanism than subdomain resolution.
- A `User` row created via Platform Admin provisioning or the (now production-disabled, §9.3) legacy
  `registerTenant()` still carries a `passwordHash` and logs in the original subdomain + email/password
  way. Both shapes coexist in the same `User` table; `firebaseUid`/`passwordHash` are each optional and
  mutually exclusive in practice, not enforced as such at the schema level.
- The Member NIK-based portal login (v2 §3) is unchanged and remains a fully separate, third
  authentication system from either `User` login shape above.

Platform admins are `User` rows with `isPlatformAdmin = true` — unchanged from v1/v2.

## 4. Core product concept: tenant, unit, and "KSU"

Unchanged from v1/v2: a tenant is one koperasi with one or more `CooperativeUnit`s; KSU is
`units.length > 1` (`isMultiUnit()`), never a stored type (`CLAUDE.md` rule 2b). Tenants are addressed
by subdomain, resolved from `Host`, never from request input — see `docs/04-System-Architecture-
SISKOP.md` §5.

### 4a. Platform vs. tenant separation

Unchanged from v1/v2 — no change this revision.

### 4b. KSU + Konsumen (Toko/POS) — now released (superseded from v2)

v2 §4b described this as a built-but-unmerged spike (SD-001 "proposed, not ratified"). **That has been
superseded: it is merged to `main`** (commit `89cd7e3`, PR #3 `a0057fe`) and is now a released
product surface — see §5's Modules table. What v2 described as the spike's contents is unchanged in
substance: baseline-behavior lock for single-unit tenants, explicit `unitId` on loan creation,
read-only consolidated asset reporting across units, per-unit member SHU statements, a Toko-only
Kasir role, and per-user unit scoping enforced fresh on every Konsumen request.

**Built on top of the merged base, on the still-unmerged `feature/piutang-anggota-toko` branch**:
Kredit Anggota (member store credit as a POS payment method) and a tenant-wide Piutang Anggota list +
repayment screen (`b4df7c6`, `1e09f81`). Business rules (decided explicitly, not assumed):

- Credit limit is auto-computed — 50% of a member's total active savings balance across all types
  (Pokok+Wajib+Sukarela), recomputed fresh on every read, never cached.
- A `MEMBER_CREDIT` sale debits a new "Piutang Anggota (Toko)" receivable account
  (`MappingTransactionKind.SALE_RECEIVABLE`) instead of Kas — accrual-correct from day one, not
  deferred.
- `MemberCreditRepayment` + a `MEMBER_CREDIT_REPAYMENT` mapping reverse the receivable (debit Kas,
  credit Piutang) — without this the limit would be single-use per member forever.
- Route permissions are `konsumen:*`, deliberately not `members:*` (the seeded Kasir role has
  `konsumen` but no `members` permission), so member search for credit is its own konsumen-scoped
  endpoint rather than reusing `/members?search=`.

This feature is real, tested (TDD, live-verified against the `demo` tenant), and included in the
412/413 test count (§7.1) — but per the same "built ≠ released" caveat v2 applied to the KSU spike
before it merged, it is **not yet on `main`** and PM has not signed off on merge timing. Flag: either
schedule the merge of `feature/piutang-anggota-toko`, or explicitly park it, so this doesn't repeat
v2's SD-001 drift on a smaller scale.

### 4c. Public landing page + self-service paid onboarding (new in v3)

A visitor now reaches `/` (marketing landing page), `/register?package=<id>` (package selection +
Firebase sign-up), `/checkout` (Xendit payment link), then `/login` (Firebase sign-in) →
`/dashboard`. Key mechanics (`apps/backend/src/modules/onboarding/service.ts`,
`docs/landing-page/README.md`):

- Registration provisions the tenant, admin `User`, first unit, seeded roles, and an
  `OnboardingOrder` in one transaction. **The tenant stays `isActive: false` and issues no dashboard
  session until payment is confirmed** — price and package name are snapshotted onto the order at
  registration time, so a later catalog price change never changes an already-placed order's quoted
  amount.
- Payment is Xendit `POST /sessions` (`session_type: PAY`, `mode: PAYMENT_LINK`, IDR, automatic
  capture) — a one-time charge, not a recurring-billing enrollment. Confirmation is webhook-driven
  (`x-callback-token` verified, then the authoritative session is re-fetched server-side and checked
  against reference ID / session ID / currency / exact Decimal amount before activating) — the
  browser's own return-URL redirect never grants access by itself.
- Only active, positive-whole-rupiah-priced packages are offered in the paid catalog
  (`catalog()`) — zero-price/internal/fractional-price packages are excluded from self-service signup
  (they still exist for Platform-Admin-provisioned tenants).
- Without Xendit/Firebase configured (`checkoutConfigured()` false), visitors can still browse the
  catalog and fill the registration form, but paid signup is disabled — the flow degrades rather than
  errors.
- Public registration/checkout endpoints are rate-limited and reject cross-origin browser mutations
  (per `docs/landing-page/README.md`); the rate-limiter store is process-local, a known gap for a
  multi-instance production deployment.

## 5. Modules and current status

Status reflects `main` plus what's ready to merge from `feature/piutang-anggota-toko` (§4b), called
out explicitly where the two differ.

| Module | Status | Evidence |
|---|---|---|
| Auth | Implemented — **QA-flagged, see §7.1 D4**; legacy self-register now prod-disabled (§9.3) | `apps/backend/src/modules/auth/` |
| Onboarding (public, paid) *(new since v2)* | Implemented | `apps/backend/src/modules/onboarding/`, `apps/frontend/src/features/onboarding/` — see §4c |
| Tenant provisioning | Implemented | `apps/backend/src/modules/tenants/provision.ts` (used by both Platform Admin and onboarding) |
| Dashboard | Implemented | `apps/backend/src/modules/dashboard/` |
| Members | Implemented — **QA-flagged, see §7.1 D6** | `apps/backend/src/modules/members/` |
| Savings | Implemented — **QA-flagged, see §7.1 D1-D3, release-blocking** | `apps/backend/src/modules/savings/` |
| Loans | Implemented | `apps/backend/src/modules/loans/` |
| Konsumen (Toko/POS/PPOB) *(released since v2; was v2 §4b spike)* | Implemented | `apps/backend/src/modules/konsumen/` — products, stock, POS sale + journal posting, PPOB stub, Kasir RBAC |
| Kredit Anggota / Piutang Anggota *(new, unmerged — §4b)* | Built, TDD-covered, **not on `main`** | `apps/backend/src/modules/konsumen/credit.service.ts`; branch `feature/piutang-anggota-toko` |
| KSU consolidated reporting / member SHU statement | Implemented | `apps/backend/src/modules/ksu/` (per §4b) |
| Accounting / ledger | Implemented | Chart of Accounts, account mappings, `lib/journal.ts` |
| Reports | Implemented — **new finding, see §7.1 D7** | Financial + full regulatory suite, PDF export |
| Config | Implemented | Units, Roles, Users, COA, Account Mappings, SHU config, Whitelabel, Modal Disetor |
| Users (Pengguna) | Implemented | `apps/backend/src/modules/users/` |
| Platform Admin | Implemented | Tenant list/provisioning/package-assignment, subscription package CRUD, platform-admin-user CRUD |
| Mobile — staff (read-only) | Implemented | Unchanged from v2 |
| Mobile — Anggota self-service (read-only) | Implemented, **P0 security defect open**, see §7.1 D6 | Unchanged from v2 |

Backend test coverage: **412/413 tests passing, 36 files** as of `feature/piutang-anggota-toko`
(current HEAD, 4 commits ahead of `main`@`d50b432`) — up from v2's 233 tests / 18 files. **One test
currently fails deterministically** (§7.1 D7); a clean coverage percentage was not obtained this
session because the v8 coverage reporter doesn't emit its summary on a run with a failing test — the
last recorded clean figure remains v2's 93.19% lines, now stale given the amount of code added since.
Re-running coverage after D7 is fixed (or excluded) is a prerequisite to re-establishing a trustworthy
number against the 80% gate. Frontend and mobile still have no automated test suite — unchanged from
v1/v2 (NFR-TEST-07).

## 6. Functional requirements (high-level)

Detailed, testable requirements live in `docs/02-System-Requirements-SISKOP.md` — unchanged summary
for Auth/Dashboard/Members/Savings/Loans/Accounting/Reports/Config/Platform Admin/Mobile, see v1 §6.
New since v2:

- **Konsumen (Toko/POS/PPOB)**: product + stock-movement CRUD, POS sale posting with stock decrement
  and a balanced journal entry, a PPOB check-and-pay skeleton against a simulated biller, unit-scoped
  RBAC via a Toko-only Kasir role. Now a released FR, not a spike.
- **Public paid onboarding**: landing page, package catalog, Firebase-based registration/login, Xendit
  checkout, webhook-confirmed tenant activation. See §4c.
- **Kredit Anggota / Piutang Anggota** *(built, not yet merged)*: member store credit at POS gated by
  an auto-computed limit, receivable accounting, and a repayment flow — a functional requirement of
  the Konsumen module once `feature/piutang-anggota-toko` merges, not an optional add-on.

## 7. Non-functional requirements

- API p99 < 500ms · dashboard load < 3s · PDF export < 10s — login still misses this target (§7.1 D5);
  unchanged from v2. No load testing/APM exists.
- 99.5% uptime · RTO < 1h · RPO < 15min · daily backups with a tested restore — **partially
  addressed**: a CI/CD pipeline now deploys `main` to Cloud Run + Firebase Hosting on every push
  (`infra/firebase/cloudbuild*.yaml`, new since v2), but nothing for database backup, restore testing,
  or a documented RTO/RPO exists yet. Deploy automation and disaster-recovery readiness are still two
  different things — only the former exists.
- Multi-tenant data isolation remains a release-blocking test category — re-confirmed 2026-09-12
  (D1-D6 re-check, §7.1), no regressions found in isolation specifically.
- Money is always `Decimal`, never float (`CLAUDE.md` rule 2) — unchanged, including the new
  Konsumen/Kredit Anggota code paths (`POSSale.totalPrice`, `MemberCreditRepayment.amount`, etc.).
- Backend test coverage: 412/413 tests, 36 files (§5) — coverage % stale, see §5's caveat.

### 7.1 QA status: carried-forward defects re-confirmed, one new automated finding (updated in v3)

**Scope note**: what follows is not a new formal QA cycle against `docs/08-QA-Test-Plan-SISKOP.md`'s
172 traceable cases — it is a 2026-09-12 re-verification done by reading the current code directly
(D1-D6) plus one live run of the automated backend suite (D7). A full QA Cycle 3 against the newly
merged Konsumen/onboarding surfaces has not been executed and is recommended before any release
decision that includes them.

| ID | Severity | Status | Module | Summary |
|---|---|---|---|---|
| D1 | P0 | **Still open**, re-confirmed 2026-09-12 | Savings | `createSaving()` (`savings/service.ts:99`) still never calls `hasPokokSaving()` — a Wajib/Sukarela saving can be opened with no Pokok on file |
| D2 | P0 | **Still open**, re-confirmed 2026-09-12 | Savings | `withdrawFromSaving()`'s `POKOK` branch (`savings/service.ts:226-236`) still only guards "no active loan," no floor/never-zero check exists |
| D3 | P0 | **Still open**, re-confirmed 2026-09-12 | Savings | `Saving` model (`schema.prisma:435`) still has no `@@unique` on `(memberId, unitId, savingConfigId)`; no app-level duplicate check either |
| D4 | P1 | **Still open, narrower exposure** | Auth | `registerTenant()`'s cross-tenant admin-email check is still absent (`auth/service.ts:88-135`, relies only on `P2002`, and `User.email` is uniqued per-tenant, not globally) — but this path is now disabled by default in production (§9.3), so real-world exposure is lower than when v2 was written |
| D5 | P2 (informational) | **Still open** | Auth / Perf | Login latency unchanged, not re-measured this session — no code change touched `BCRYPT_ROUNDS` |
| D6 | **P0** | **Still open**, re-confirmed 2026-09-12 | Member Portal (mobile) | `member-portal/routes.ts:24` still gates only on `requireMemberAuth`; `mustChangePassword` is still never checked anywhere in the module — the NIK-derivable-default-password auth bypass from v2 is unchanged |
| D7 | **P0/P1 (unassessed — needs Engineer/QA severity call)** | **New, found 2026-09-12** | Reports (regulatory Neraca) | Explicit `asOfDate` excludes same-day transactions that the no-param path includes, reproducibly, during part of every day |

**D7 detail**: `tests/reports.test.ts`'s own regression test for the historical "date-range endpoint"
bug class (see project memory `siskop_v3_date_range_endpoint_bug_class`) now fails deterministically:
`GET /api/reports/regulatory/neraca?asOfDate=<today>` returns `aset.total: "0"` where the no-param
call (same instant) returns `"500000"`. Root cause: `reports/routes.ts:117/129` does
`endOfDay(new Date(asOfDate))` where `asOfDate` is a bare `YYYY-MM-DD` string — `new Date("YYYY-MM-DD")`
parses as **UTC midnight**, but `endOfDay()` (date-fns) computes 23:59:59.999 in the **server's local
time zone**. On this machine (WIB, UTC+7), any request made between local 00:00 and ~07:00 has a UTC
"calendar date" one day behind the local one; parsing the client's locally-meant date as UTC then
taking a local end-of-day silently produces a cutoff hours before "now," excluding transactions from
earlier the same local day. This reproduced twice, deterministically, in isolation
(`vitest run tests/reports.test.ts`) — not a flaky/order-dependent failure. **Impact**: any regulatory
report (Neraca and likely its siblings sharing this helper) requested with an explicit date during
that local time-of-day window under-reports same-day activity — a money-correctness category finding
per test-plan §3.3, though Engineer/QA should assign the formal severity rather than this document
guessing it. **Suggested fix**: parse `asOfDate` as a local calendar date (e.g. construct
`new Date(year, month-1, day)` from its parts, or use a date-only library helper) before calling
`endOfDay`, instead of routing a local-meant date string through a UTC parse.

**Release recommendation carries forward as No-Go** — D1-D3/D6 remain independently release-blocking
per test-plan §3.3 exactly as in v2, and D7 adds a fresh money-correctness question mark over the
regulatory reports specifically. PM/Engineer should treat D1-D3/D6 (unchanged) and a severity call on
D7 (new) as preconditions to any release announcement touching Savings, the member portal, or
regulatory reporting.

## 8. Subscription & entitlement model

Base model unchanged from v1/v2: `SubscriptionPackage`, base-modules-free / accounting+whitelabel
gated via `requireAccountingEntitlement`/`requireWhitelabelEntitlement`, quota fields
(`maxUsers`/`maxMembers`/`maxSavingConfigs`) still **read but not enforced** anywhere member/user
creation happens — confirmed unchanged 2026-09-12 (only referenced in `platform/` and `onboarding/`
modules, not in `members/` or `users/`).

**New this revision**: the onboarding flow (§4c) is the first place `SubscriptionPackage.price` is
ever actually collected as money, via Xendit. This is still a **one-time** charge per registration,
not a subscription in the billing sense — `nextBillingDate` is set one month out on payment
confirmation, but nothing reads it to re-charge, remind, or deactivate a lapsed tenant. Treat
"subscription" in this system, still, as "an assigned package that gates feature access," not
"a recurring billing relationship" — that gap is explicitly named as future work in
`docs/landing-page/README.md`, not an oversight this document is newly discovering.

## 9. Open product decisions

Items 1-4, 6-8 unchanged from v1 (see v1 §9). Item 5 (members have their own login, still not
QA-cleared) unchanged from v2 §9.1 — D6 is still open, so v2's framing stands as-is. Item 9 (v2 §9.2,
SD-001/KSU-Konsumen) is **resolved by the merge** (§4b) — no longer an open decision, superseded.

### 9.3 New this revision

10. **Legacy self-service tenant registration (`POST /api/auth/register`) is now disabled by default
    in production**, in favor of the paid onboarding flow (§4c) and direct Platform Admin provisioning.
    This is a good-faith engineering decision (closing off an unauthenticated tenant-creation path
    that D4, §7.1, shows has a real bug) but **has not been explicitly ratified as a product decision**
    the way SD-001 eventually was — PM should confirm this is the intended permanent shape (no
    self-service *unpaid* trial signup path at all) rather than an incidental side effect of building
    the paid flow.
11. **`feature/piutang-anggota-toko` (Kredit Anggota, Piutang Anggota, sidebar restructure, reload
    fix) is built and tested but not merged to `main`** (§4b, §5). Same drift risk v2 flagged for the
    KSU spike before it merged: either schedule the merge or explicitly park it.
12. **A QA Cycle 3 covering the newly-merged Konsumen/onboarding surfaces has not been run.** §7.1's
    2026-09-12 pass was a targeted re-check of v2's existing defects plus whatever the automated suite
    caught (D7), not a fresh pass through `docs/08-QA-Test-Plan-SISKOP.md`'s full case list against
    Konsumen, PPOB, or the paid-onboarding flow. Recommend scheduling one before wider rollout of
    either.

## 10. Success metrics and instrumentation gap

Unchanged from v1/v2: no metrics/analytics pipeline exists yet (`docs/04-System-Architecture-
SISKOP.md` §9).

## 11. Related documents

- `docs/01-PRD-SISKOP-v2.md` — v2 of this document (2026-09-11), retained for history
- `docs/01-PRD-SISKOP.md` — v1 (2026-07-29), retained for history
- `docs/02-System-Requirements-SISKOP.md` through `docs/09-QA-Test-Cases-SISKOP.md`,
  `docs/qa-cycle2-2026-09-11/` — unchanged from v2, see v2 §11
- `docs/landing-page/README.md`, `apps/frontend/src/features/onboarding/README.md`,
  `infra/firebase/README.md`, `infra/firebase/CONTINUOUS-DEPLOYMENT.md`,
  `infra/firebase/VERIFICATION.md` — public onboarding, payment, and deploy-pipeline documentation
  (§4c, §7), new since v2
- `docs/2026-09-10-ksu-mvp-week1.md`, `docs/2026-09-10-ksu-mvp-compressed-2day.md`,
  `docs/ksu-konsumen-backend.md`, `docs/ksu-konsumen-frontend.md`, `docs/ksu-mvp-frontend.md`,
  `docs/ksu-mvp-week1-demo.md` — KSU/Konsumen planning docs; the feature they planned is now merged
  (§4b), these remain as historical design record
- `docs/claude-integration/PM-INSTRUCTIONS.md` — PM decision authority and targets
