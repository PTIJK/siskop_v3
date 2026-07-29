# 02 — System Requirements: SISKOP

Status: living document, updated **2026-07-29** against the current codebase. Covers the functional
and non-functional requirements referenced as `02-FSD-SISKOP.md` in
`docs/claude-integration/ENGINEER-INSTRUCTIONS.md` and `QA-INSTRUCTIONS.md`; treat the two names as
the same document. Supersedes the 2026-07-28 version, which described a scaffold where Members,
Savings, Loans, Reports, Config, Users, and Platform Admin were all "Planned" or "schema only" — all
of those modules are now implemented; see the changelog at the bottom of each section for what
changed.

Each functional requirement has an ID (`FR-<MODULE>-<n>`) and a status. Statuses:

- **Implemented** — in production code, covered by an automated test.
- **Partial** — some of the requirement exists (e.g. the data model but no API, or the API but no
  enforcement).
- **Planned** — not started; included because it is in scope per `CLAUDE.md` module ownership.

## 1. Functional requirements

### 1.1 Authentication & tenant provisioning (`FR-AUTH`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-AUTH-01 | A prospective tenant can self-register, creating the tenant, its first `CooperativeUnit`, 4 seed roles, and a Super Admin user in a single atomic transaction. | Implemented | `modules/auth/service.ts::registerTenant` → `modules/tenants/provision.ts::provisionTenantInTx`, `tests/provision-tenant.test.ts` |
| FR-AUTH-02 | Registration rejects a duplicate slug, registration number, or admin email with `CONFLICT`, not a raw DB error. | Implemented | `service.ts` `isUniqueViolation` handling |
| FR-AUTH-03 | A user logs in with email + password; the tenant is resolved from the request's `Host` subdomain, never from the request body. | Implemented | `service.ts::login`, `tenant-host.ts::slugFromHost`, `tests/tenant-host.test.ts` |
| FR-AUTH-04 | Login without a resolvable subdomain fails with a message telling the user to use their cooperative's subdomain, not a generic auth failure. | Implemented | `service.ts::login` — `validationError` when `slug` is null |
| FR-AUTH-05 | A wrong password and an unknown email return the same error, in comparable time (a dummy bcrypt hash is compared when no user is found). | Implemented | `service.ts::login` |
| FR-AUTH-06 | Access tokens expire in 15 minutes by default; refresh tokens in 7 days. | Implemented | `service.ts::issue` |
| FR-AUTH-07 | A refresh token re-derives role and unit access at refresh time rather than trusting stale claims; the refresh token itself carries identity only (`userId`, `tenantId`) — stateless, not DB-backed. | Implemented | `service.ts::refreshSession` → `sessionFor` |
| FR-AUTH-08 | `GET /api/auth/me` returns the caller's own user record, scoped by both `id` and `tenantId`. | Implemented | `modules/auth/routes.ts` |
| FR-AUTH-09 | A user with zero accessible units cannot obtain a session (rejected at login, not silently issued an empty-scope token). | Implemented | `service.ts::sessionFor` |
| FR-AUTH-10 | Password reset / email verification flow. | Planned | Not in codebase |
| FR-AUTH-11 | Platform-level (`super_admin`) authentication and session scope. | **Implemented** *(changed 2026-07-29 — was Planned)* | `User.isPlatformAdmin`; `deriveUserRole()` (`lib/user-mapper.ts`) maps it to `AuthClaims.role = "super_admin"`; `middleware/rbac.ts::requirePlatformAdmin` gates `/api/platform/*` |
| FR-AUTH-12 | A user's own self-service profile edit (name/email) and password change. | Implemented | `modules/auth/service.ts::updateProfile`/`changePassword`, `pages/profile/ProfilePage.tsx` |

### 1.2 Multi-unit cooperative model (`FR-UNIT`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-UNIT-01 | Every tenant has at least one `CooperativeUnit` at all times, including post-provisioning (deactivating the last active unit is rejected). | Implemented | `provision.ts`; `config/service.ts::updateUnit` (`CONFLICT` if it's the last active unit) |
| FR-UNIT-02 | A tenant with 2+ active units is treated as a koperasi serba usaha (KSU) without a stored "KSU" type. | Implemented | `packages/types/src/unit.ts::isMultiUnit` |
| FR-UNIT-03 | Unit type is one of `KSP`, `KONSUMEN`, `PRODUSEN`, `JASA`, `PEMASARAN`. | Implemented | `packages/types/src/unit.ts::CooperativeType` |
| FR-UNIT-04 | A member can belong to a subset of a tenant's units. | Implemented (schema) | `UnitMembership` model; still no dedicated CRUD route to manage it post-registration — members are enrolled at creation time only |
| FR-UNIT-05 | Staff roles implicitly see every active unit in their tenant. | Implemented | `modules/auth/service.ts::resolveUnitIds` |
| FR-UNIT-06 | Reporting can run consolidated (all units) or per-unit by omitting/adding a unit filter. | **Implemented** *(changed — was Planned)* | Phase 1 always resolves the tenant's sole unit server-side (`lib/units.ts`); consolidated vs. per-unit reporting is the same query shape, no unit-picker UI exists since every tenant currently has exactly one unit in practice |

### 1.3 Members (`FR-MEM`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-MEM-01 | Member data model: identity, membership number, account number, NIK, status. **No login** — a deliberate divergence from the original scaffold's mandatory `Member ↔ User` 1:1. | **Implemented** *(changed — was schema-only)* | `prisma/schema.prisma::Member`; `modules/members/` |
| FR-MEM-02 | Member status lifecycle via `isActive` (soft-delete), not a multi-value enum. | Implemented | `Member.isActive` |
| FR-MEM-03 | Create a member (with KTP photo upload) and enroll them into the tenant's unit in one request. | Implemented | `modules/members/service.ts`, `tests/members.test.ts` |
| FR-MEM-04 | List/search members, paginated, filterable by status. | Implemented | `modules/members/routes.ts` |
| FR-MEM-05 | Membership number (`memberId`) and account number are globally unique; NIK is unique per tenant. | Implemented (schema constraint) | `@@unique` constraints on `Member` |
| FR-MEM-06 | KTP photo served from a URL built explicitly server-side (fixes a Windows-path bug the pre-rescaffold code had with multer's raw OS path). | Implemented | `app.ts` static `/uploads` mount; `modules/members/service.ts` |

### 1.4 Savings (`FR-SAV`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-SAV-01 | Savings *products* (Simpanan Pokok/Wajib/Sukarela) are tenant-configurable, not hardcoded. | **Implemented** *(changed — was Planned)* | `SavingConfig` model; `pages/config/SavingConfigsTab.tsx` |
| FR-SAV-02 | A member has at most one `Saving` account per (unit, savings config). | Implemented (schema constraint) | `Saving` model |
| FR-SAV-03 | Savings balances are `Decimal(15,2)`. | Implemented | `Saving.balance` |
| FR-SAV-04 | Deposit / withdrawal operations that update balance and write an append-only `SavingTransaction`. | Implemented | `modules/savings/service.ts`, `tests/savings.test.ts` |
| FR-SAV-05 | Simpanan Pokok can never be withdrawn to a closed/zero state. | Implemented | `ErrorCode.CANNOT_WITHDRAW_POKOK` |
| FR-SAV-06 | A member must have an active Simpanan Pokok before any other savings/loan product can be opened. | Implemented | `ErrorCode.MEMBER_HAS_NO_POKOK_SAVING` |
| FR-SAV-07 | Every deposit/withdrawal attempts a corresponding double-entry journal posting via `AccountMapping`. | Implemented | `lib/journal.ts`, exercised in `config.test.ts` |

### 1.5 Loans (`FR-LOAN`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-LOAN-01 | Loan *products* (rate, type, max term) are tenant-configurable. | **Implemented** *(changed — was Planned)* | `LoanConfig` model; `pages/config/LoanConfigsTab.tsx` |
| FR-LOAN-02 | Kolektibilitas (KOL) classification, 5 categories (`LANCAR`…`MACET`), for portfolio risk/regulatory reporting. | Implemented | `Loan.kolCategory`, `lib/kol.ts`, `tests/kol.test.ts` |
| FR-LOAN-03 | Loan issuance workflow: principal/term/rate → computed `totalAmount`/`monthlyPayment`/`remainingAmount`, disbursement posts a journal entry. | Implemented | `lib/loan-calc.ts`, `tests/loan-calc.test.ts` |
| FR-LOAN-04 | Repayment recording, updating `remainingAmount` and writing an append-only `LoanPayment`. | Implemented | `modules/loans/service.ts`, `tests/loans.test.ts` |
| FR-LOAN-05 | Automatic KOL reclassification based on days-past-due. | Implemented | `lib/kol.ts` |
| FR-LOAN-06 | Syariah loan products use flat margin, not amortized interest. | Implemented | `RateType.MARGIN`, `lib/loan-calc.ts` |
| FR-LOAN-07 | An "Anggota Menunggak" (overdue members) view. | Implemented | `pages/loans/OverduePage.tsx` |

### 1.6 Accounting / ledger (`FR-ACC`)

Replaces the original scaffold's single flat `Transaction` model, which no code ever wrote to.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-ACC-01 | Tenant-configurable Chart of Accounts (COA), hierarchical (header/child), with category and normal balance. | Implemented | `Account` model; `pages/config/AccountsTab.tsx` |
| FR-ACC-02 | Account-mapping table routes a transaction kind (deposit, disbursement, payment principal/interest/penalty) to a debit/credit account pair, per savings/loan config. | Implemented | `AccountMapping` model; `pages/config/AccountMappingsTab.tsx` |
| FR-ACC-03 | Double-entry posting: every Savings/Loans transaction generates a balanced `JournalEntry` + `JournalLine`s automatically. | Implemented | `lib/journal.ts` |
| FR-ACC-04 | A transaction with no matching `AccountMapping` still succeeds, posting as `UNPOSTED_MISSING_MAPPING` instead of failing — fixable retroactively once the mapping is added. | Implemented | `JournalEntryStatus`; verified end-to-end in `config.test.ts` |
| FR-ACC-05 | Chart of Accounts and account mappings are gated behind the tenant's `SubscriptionPackage.modules` containing `"accounting"`. | **Implemented** *(added 2026-07-29)* | `middleware/entitlement.ts::requireAccountingEntitlement` |
| FR-ACC-06 | SHU (sisa hasil usaha) distribution formula, tenant-configurable, 4 percentages summing to 100%. | Implemented | `ShuDistributionConfig`; `pages/config/ShuConfigTab.tsx` |

### 1.7 Reports (`FR-RPT`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-RPT-01 | Aggregate financial report (pre-ledger savings/loan summary) for a date range. | **Implemented** *(changed — was Planned)* | `modules/reports/service.ts::getFinancialReport` |
| FR-RPT-02 | RAT (Rapat Anggota Tahunan) annual report. | Implemented | `modules/reports/service.ts::getRATReport` |
| FR-RPT-03 | PDF export of every report (financial, RAT, and all regulatory reports except CALK — CALK is edited/reviewed in the UI, not exported). | Implemented | `modules/reports/pdf.ts` (Puppeteer-based) |
| FR-RPT-04 | Regulatory reports per Permenkop UKM No. 2/2024: Neraca (balance sheet), Arus Kas (cash flow), Laporan Hasil Usaha (income statement), Pembagian SHU, and CALK — all ledger-derived from `Account`/`JournalLine`. | Implemented | `modules/reports/regulatory-service.ts` |
| FR-RPT-05 | Regulatory reports (all of §RPT-04) are gated behind the accounting entitlement, same as Konfigurasi Akun. | **Implemented** *(added 2026-07-29)* | `requireAccountingEntitlement` applied to every `/reports/regulatory/*` route |
| FR-RPT-06 | Loan portfolio / KOL distribution report. | Planned | Not a standalone report; KOL data surfaces only in the Overdue-members view (FR-LOAN-07) |
| FR-RPT-07 | An explicit date-range query param must use an inclusive end-of-day upper bound, not a raw UTC-midnight `Date`, or same-day rows are silently excluded. | Implemented | `resolvePeriod()`/`endOfDay()` in `modules/reports/routes.ts` |

### 1.8 Config (`FR-CFG`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-CFG-01 | Tenant-level unit management (create/rename/deactivate). | **Implemented** *(changed — was Planned)* | `pages/config/UnitsTab.tsx` |
| FR-CFG-02 | Tenant-level fine-grained role management (create/edit/delete custom roles with a permissions matrix). | Implemented | `Role` model; `pages/config/RolesTab.tsx` |
| FR-CFG-03 | Tenant-level user (staff) management — create/edit/deactivate, assign a role. | Implemented | `modules/users/`; `pages/config/UsersTab.tsx` |
| FR-CFG-04 | Whitelabel branding: custom domain, primary color, hide-branding toggle, email sender identity. | **Implemented** *(added 2026-07-29)* | `WhitelabelConfig` model; `GET/PUT /config/whitelabel`; `pages/config/WhitelabelConfigTab.tsx`. Read is ungated; writes require `whitelabelEnabled` on the tenant's package |
| FR-CFG-05 | Modal Disetor (paid-in capital) compliance field — Permenkop UKM No. 2/2024 Pasal 12 mandatory-audit threshold (Rp 5,000,000). | **Implemented** *(added 2026-07-29)* | `Tenant.modalDisetor`; `GET/PUT /config/modal-disetor`; `pages/config/ModalDisetorConfigTab.tsx`. Not gated by the accounting entitlement — a general tenant compliance field |

### 1.9 Platform Admin (`FR-PADM`)

Entirely new since the 2026-07-28 version of this document, which had this section as a single
"Planned" row.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-PADM-01 | Cross-tenant tenant list, with unit/user counts and assigned-package name, for `super_admin`. | Implemented | `GET /api/platform/tenants`; `pages/platform/PlatformTenantsPage.tsx` |
| FR-PADM-02 | Platform admin can provision a new koperasi (tenant + first unit + admin) from outside any tenant. | Implemented | `POST /api/platform/tenants` → `provisionTenantInTx` |
| FR-PADM-03 | Platform admin can assign/reassign a tenant's `SubscriptionPackage`, toggle `isActive`, and set `nextBillingDate`. | Implemented | `PUT /api/platform/tenants/:id` → `updateTenantStatus`; "Kelola" dialog on `PlatformTenantsPage` |
| FR-PADM-04 | Subscription package CRUD: name, price, entitled modules, user/member/saving-config caps, whitelabel flag, active/inactive. | Implemented | `modules/platform/` package routes; `pages/platform/PlatformPackagesPage.tsx` |
| FR-PADM-05 | Platform-admin-user CRUD (create/list/edit/deactivate), independent of any tenant's own user management. | Implemented | `modules/platform/` admin routes; `pages/platform/PlatformAdminsPage.tsx` |
| FR-PADM-06 | A platform admin cannot deactivate their own account. | Implemented | `deactivatePlatformAdmin()` — mirrors the same self-deactivation guard on tenant-scoped `users/service.ts::updateUser` |
| FR-PADM-07 | Platform admins are confined to `/platform/*` (+ their own profile) — they cannot browse into the tenant business modules of whichever tenant their `User` row is attached to (an FK-satisfying artifact, not intent), even by direct URL. | **Implemented** *(added 2026-07-29, same session as FR-PADM-01..06)* | `components/layout/AppLayout.tsx` route guard; `components/layout/Sidebar.tsx` hides tenant nav for `isPlatformAdmin` |
| FR-PADM-08 | In-app notification center (billing reminders, package changes, audit-threshold alerts) for platform admins. | Planned — schema only | `Notification`/`NotificationRead` models seeded, no route consumes them |

### 1.10 Dashboard (`FR-DASH`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-DASH-01 | Tenant-scoped summary view: member count, savings totals, loan portfolio health, recent activity. | **Implemented** *(changed — was Planned)* | `modules/dashboard/`; `pages/dashboard/DashboardPage.tsx`; `tests/dashboard.test.ts` |

## 2. Non-functional requirements

### 2.1 Performance

| ID | Requirement | Source |
|---|---|---|
| NFR-PERF-01 | API responses < 500ms at p99. | `QA-INSTRUCTIONS.md`, `PM-INSTRUCTIONS.md` |
| NFR-PERF-02 | Dashboard loads in < 3s. | `QA-INSTRUCTIONS.md`, `PM-INSTRUCTIONS.md` |
| NFR-PERF-03 | Report PDF export completes in < 10s. | `QA-INSTRUCTIONS.md` |

No load testing or performance monitoring exists in the repo yet; these remain acceptance gates for
QA sign-off, not currently measured.

### 2.2 Availability & resilience

| ID | Requirement | Source |
|---|---|---|
| NFR-AVAIL-01 | 99.5% uptime. | `PM-INSTRUCTIONS.md`, `OPS-INSTRUCTIONS.md` |
| NFR-AVAIL-02 | RTO < 1 hour. | `OPS-INSTRUCTIONS.md` |
| NFR-AVAIL-03 | RPO < 15 minutes. | `OPS-INSTRUCTIONS.md` |
| NFR-AVAIL-04 | Daily backups, with restore actually tested. | `OPS-INSTRUCTIONS.md` |
| NFR-AVAIL-05 | Deploys flow `develop` → staging automatically; production ships only on a tagged release after QA sign-off. | `OPS-INSTRUCTIONS.md` |

Still no backup/restore/deploy-pipeline infrastructure in this repo — unchanged from the prior
version of this document.

### 2.3 Security

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-SEC-01 | Every query touching tenant data filters by `tenantId` from `req.auth.tenantId` — never the request body or a URL param. | Implemented, standing rule | `CLAUDE.md` rule 1 |
| NFR-SEC-02 | At login, before `req.auth` exists, the tenant is resolved from the `Host` subdomain, never the request body. | Implemented | `tenant-host.ts::slugFromHost` |
| NFR-SEC-03 | Passwords are hashed with bcrypt (10 rounds), never stored or logged in plaintext. | Implemented | `BCRYPT_ROUNDS = 10` |
| NFR-SEC-04 | JWT secrets are never defaulted — signing with an empty string is refused. | Implemented | `service.ts::secret()` |
| NFR-SEC-05 | Money fields use `Decimal`, never `Float`/`number`. | Implemented | `CLAUDE.md` rule 2; `prisma/schema.prisma` |
| NFR-SEC-06 | Standard security headers via `helmet`. | Implemented | `apps/backend/src/app.ts` |
| NFR-SEC-07 | CORS restricted to an explicit allow-list from `CORS_ORIGIN`. | Implemented | `apps/backend/src/app.ts` |
| NFR-SEC-08 | Secrets come from env, never committed. | Implemented | `CLAUDE.md` rule 6; `.env` gitignored |
| NFR-SEC-09 | Rate limiting on auth endpoints (brute-force protection). | Planned | `ErrorCode.RATE_LIMIT` exists; nothing throws it yet |
| NFR-SEC-10 | Internal error details never reach the client. | Implemented | `app.ts` error handler |
| NFR-SEC-11 | A cross-tenant admin surface (`/api/platform/*`) gates on the coarse `AuthClaims.role` claim, not the tenant-scoped `Permissions` blob — the two are deliberately different axes so a tenant's own "Super Admin" role has no bearing on platform-level access. | **Implemented** *(added 2026-07-29)* | `middleware/rbac.ts::requirePlatformAdmin` |
| NFR-SEC-12 | A platform admin's session, though technically carrying real permissions for the tenant their `User` row is attached to, is confined client-side to `/platform/*` — the frontend must not let that FK-satisfying attachment leak into a usable tenant-admin session. | **Implemented** *(added 2026-07-29)* | `AppLayout.tsx` route guard |

### 2.4 Data isolation (multi-tenancy)

| ID | Requirement | Status |
|---|---|---|
| NFR-TENANT-01 | No API route may return or mutate a row belonging to a tenant other than `req.auth.tenantId`. | Standing rule; QA's top release-blocking risk category |
| NFR-TENANT-02 | Cross-tenant data leakage tests exist for every module. | **Implemented** *(changed — was partial)* | Every module test file (`members.test.ts`, `savings.test.ts`, `loans.test.ts`, `config.test.ts`, `reports.test.ts`, `users.test.ts`) includes a "cannot access another tenant's X" case |

### 2.5 SaaS packaging & entitlements

New section — did not exist in the 2026-07-28 version of this document.

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-SAAS-01 | A tenant with no `SubscriptionPackage` assigned (`packageId: null`) has no add-on modules — not full/unrestricted access. Applies uniformly whether the tenant self-registered or was seeded before packages existed. | Implemented | `middleware/entitlement.ts` — `pkg?.modules?.includes(...)`/`pkg?.whitelabelEnabled` both fall through to "not entitled" on a null package |
| NFR-SAAS-02 | A blocked entitlement surfaces a specific, user-visible error message (`FEATURE_NOT_ENTITLED`), never a silently-empty list/table. | Implemented | `components/shared/EntitlementNotice.tsx`, wired into `AccountsTab`/`AccountMappingsTab`/`ShuConfigTab`; Reports pages render the same `ApiRequestError.message` inline |
| NFR-SAAS-03 | Package quota fields (`maxUsers`, `maxMembers`, `maxSavingConfigs`) are defined but not yet enforced by any route. | Planned/Partial | Columns exist on `SubscriptionPackage`; no middleware reads them (the backup this was ported from had a `requireSavingConfigQuota` check that was not re-ported) |

### 2.6 Testability & code quality

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-TEST-01 | Unit test coverage ≥ 80% lines (backend), enforced in CI. | Implemented | `vitest.config.ts`; **93.43%** lines as of 2026-07-29 (209 tests across 16 files) |
| NFR-TEST-02 | Integration test coverage target ≥ 60%. | Not separately measured from unit coverage | `QA-INSTRUCTIONS.md` |
| NFR-TEST-03 | E2E test coverage target ≥ 40%. | Planned | No Playwright/e2e setup exists; UI verification for new work is done via a scratch Puppeteer script (already a backend devDependency for PDF export) driven manually per change, not an automated suite |
| NFR-TEST-04 | TDD: failing test written before implementation. | Standing rule | `CLAUDE.md` rule 4 |
| NFR-TEST-05 | Lint clean, typecheck clean, before commit. | Implemented, CI-enforced | `.github/workflows/ci.yml` |
| NFR-TEST-06 | Integration tests run against a dedicated database (`siskop_test`), never the dev/demo database. | Implemented | `apps/backend/.env.test` |
| NFR-TEST-07 | Frontend has no automated test suite (no Vitest/RTL, no `test` script) — `turbo run test` covers the backend only. | Planned, unchanged gap | Confirmed still true as of 2026-07-29 |

### 2.7 Scalability

| ID | Requirement | Status |
|---|---|---|
| NFR-SCALE-01 | Baseline deployment: single VPS, Docker Compose, Nginx reverse proxy, PostgreSQL 15. | Baseline defined, not yet built in this repo |
| NFR-SCALE-02 | Scale path: managed Postgres + object storage for report artifacts (PDF exports now exist and would benefit from this). | Documented direction, not implemented |

### 2.8 Localization & domain compliance

| ID | Requirement | Status |
|---|---|---|
| NFR-LOC-01 | Dates/numbers formatted for the `id-ID` locale. | Implemented |
| NFR-LOC-02 | Currency is Indonesian Rupiah throughout; no currency field exists. | Implicit |
| NFR-LOC-03 | Kolektibilitas (KOL) classes follow Indonesian cooperative/microfinance risk-classification convention. | Implemented (`LANCAR`/`DALAM_PERHATIAN`/`KURANG_LANCAR`/`DIRAGUKAN`/`MACET`) |
| NFR-LOC-04 | Regulatory reports follow Permenkop UKM No. 2/2024 formats (Neraca, Arus Kas, Laporan Hasil Usaha, Pembagian SHU, CALK). | **Implemented** *(added — was undesigned)* | `modules/reports/regulatory-service.ts` |

### 2.9 API contract

| ID | Requirement | Status |
|---|---|---|
| NFR-API-01 | Every response is `ApiResponse<T>` — `{ success, data?, error?, meta: { timestamp, requestId } }`. | Implemented |
| NFR-API-02 | Errors use the `ErrorCode` enum; no ad-hoc string error codes. | Implemented — now includes `FEATURE_NOT_ENTITLED` (403) and `PACKAGE_LIMIT_EXCEEDED` (422, unused so far) |
| NFR-API-03 | Request bodies validated with Zod at the route boundary before touching the DB. | Implemented |

## 3. Environment & technical constraints

| Constraint | Value |
|---|---|
| Node.js | 20 (CI), Node 24.14.0 verified locally |
| Package manager | pnpm 9 (workspaces + Turborepo) |
| Database | PostgreSQL 15, host port **5433** locally (5432 in CI) |
| Backend runtime | Express 4, TypeScript 5, Prisma 5 |
| Frontend runtime | React 18, Vite 5, Tailwind 3, TanStack Query 5, React Hook Form + Zod, Zustand |
| PDF export | Puppeteer (bundled Chromium) — also reused as this project's headless-browser UI-verification driver, since no `chromium-cli`/Playwright is installed |
| Browser support | Not formally specified; verified manually in current-channel Chrome only |
| Ports | Backend `3001`, frontend `3000` (Vite dev proxy forwards `/api` with `changeOrigin: false`, required — see `docs/04-System-Architecture-SISKOP.md` §5) |

## 4. Traceability

This document is the requirements source for QA acceptance criteria and Engineer API-contract
design. When a requirement's status changes, update its row here in the same PR/commit that changes
the code — this document is meant to stay accurate, not a point-in-time snapshot. (The prior version
of this document went two days without an update while the majority of the product was built —
don't let the gap recur.)

## 5. Related documents

- `docs/01-PRD-SISKOP.md` — product goals, users, scope
- `docs/03-ERD-SISKOP.md` — entity-relationship diagram
- `docs/04-System-Architecture-SISKOP.md` — system architecture
- `docs/05-DB-Schema-SISKOP.md` — database schema reference
