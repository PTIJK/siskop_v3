# 02 — System Requirements: SISKOP

Status: living document, written against the codebase as of 2026-07-28 (commit `93e0f1b`).
Covers the functional and non-functional requirements referenced as `02-FSD-SISKOP.md` in
`docs/claude-integration/ENGINEER-INSTRUCTIONS.md` and `QA-INSTRUCTIONS.md` — those instruction
files pointed at a document that, per `SETUP-VERIFICATION.md` "Known gaps", was never created.
This document fills that gap under the name the current task requested; treat the two names as
the same document.

Each functional requirement has an ID (`FR-<MODULE>-<n>`) and a status. Statuses:

- **Implemented** — in production code, covered by an automated test.
- **Partial** — some of the requirement exists (e.g. the data model but no API).
- **Planned** — not started; included because it is in scope per `CLAUDE.md` module ownership.

## 1. Functional requirements

### 1.1 Authentication & tenant provisioning (`FR-AUTH`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-AUTH-01 | A prospective tenant can self-register, creating the tenant, its first `CooperativeUnit`, and a `tenant_admin` user in a single atomic transaction. | Implemented | `apps/backend/src/modules/auth/service.ts::registerTenant`, `tests/provision-tenant.test.ts` |
| FR-AUTH-02 | Registration rejects a duplicate slug, cooperative registry ID, or tenant email with `CONFLICT`, not a raw DB error. | Implemented | `service.ts` `isUniqueViolation` handling |
| FR-AUTH-03 | A user logs in with email + password; the tenant is resolved from the request's `Host` subdomain, never from the request body. | Implemented | `service.ts::login`, `tenant-host.ts::slugFromHost`, `tests/tenant-host.test.ts` |
| FR-AUTH-04 | Login without a resolvable subdomain (e.g. bare `localhost`) fails with a message telling the user to use their cooperative's subdomain, not a generic auth failure. | Implemented | `service.ts::login` — `validationError` when `slug` is null |
| FR-AUTH-05 | A wrong password and an unknown email return the same error, in comparable time (a dummy bcrypt hash is compared when no user is found). | Implemented | `service.ts::login` |
| FR-AUTH-06 | Access tokens expire in 15 minutes by default (`JWT_EXPIRES_IN`); refresh tokens in 7 days (`JWT_REFRESH_EXPIRES_IN`). | Implemented | `service.ts::issue` |
| FR-AUTH-07 | A refresh token re-derives role and unit access at refresh time rather than trusting stale claims. | Implemented | `service.ts::refreshSession` → `sessionFor` |
| FR-AUTH-08 | `GET /api/auth/me` returns the caller's own user record, scoped by both `id` and `tenantId`. | Implemented | `routes.ts` |
| FR-AUTH-09 | A user with zero accessible units cannot obtain a session (rejected at login, not silently issued an empty-scope token). | Implemented | `service.ts::sessionFor` |
| FR-AUTH-10 | Password reset / email verification flow. | Planned | Not in codebase (`SETUP-VERIFICATION.md` "Known gaps") |
| FR-AUTH-11 | Platform-level (`super_admin`) authentication and session scope. | Planned | `super_admin` exists only as a `UserRole` value; no provisioning path creates one |

### 1.2 Multi-unit cooperative model (`FR-UNIT`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-UNIT-01 | Every tenant has at least one `CooperativeUnit` at all times. | Implemented (app-enforced) | `provision.ts`, `service.ts::registerTenant` — both create the unit inside the tenant's creation transaction |
| FR-UNIT-02 | A tenant with 2+ active units is treated as a koperasi serba usaha (KSU) without a stored "KSU" type. | Implemented | `packages/types/src/unit.ts::isMultiUnit` |
| FR-UNIT-03 | Unit type is one of `KSP`, `KONSUMEN`, `PRODUSEN`, `JASA`, `PEMASARAN`. | Implemented | `packages/types/src/unit.ts::CooperativeType` |
| FR-UNIT-04 | A member can belong to a subset of a tenant's units (not automatically all of them). | Implemented (schema) | `UnitMembership` model; no CRUD route yet to manage it post-registration |
| FR-UNIT-05 | Staff roles (`tenant_admin`, `accountant`) implicitly see every active unit in their tenant; `member` sees only joined units. | Implemented | `service.ts::resolveUnitIds` |
| FR-UNIT-06 | Reporting can run consolidated (all units) or per-unit by omitting/adding a unit filter. | Planned | No reporting code yet; this is the intended query shape per `CLAUDE.md` rule 2b |

### 1.3 Members (`FR-MEM`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-MEM-01 | Member data model: identity (linked 1:1 to a `User`), membership number, status, join date, contact info. | Partial (schema only) | `prisma/schema.prisma::Member` |
| FR-MEM-02 | Member status lifecycle: `active`, `inactive`, `suspended`. | Partial (schema only) | `packages/types/src/member.ts::MemberStatus` |
| FR-MEM-03 | Create a member and enroll them into one or more units in one request. | Planned | `CreateMemberRequest` type defined, no route/service implementation |
| FR-MEM-04 | List/search members, paginated, filterable by unit and status. | Planned | `ListMembersQuery` type defined, no route/service implementation |
| FR-MEM-05 | Membership number (`membershipId`) is unique per tenant. | Implemented (schema constraint) | `@@unique([tenantId, membershipId])` |

### 1.4 Savings (`FR-SAV`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-SAV-01 | A member has at most one account per (unit, savings type) — `simpanan_pokok`, `simpanan_wajib`, `simpanan_sukarela`. | Implemented (schema constraint) | `@@unique([unitId, memberId, type])` |
| FR-SAV-02 | Savings balances are `Decimal(18,2)`. | Implemented (schema) | `SavingsAccount.balance` |
| FR-SAV-03 | Deposit / withdrawal operations that update balance and write a `Transaction`. | Planned | No service layer |
| FR-SAV-04 | Savings account opening, closing, and interest/jasa calculation (if applicable). | Planned | Undesigned |

### 1.5 Loans (`FR-LOAN`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-LOAN-01 | Loan record: principal, interest rate, term (months), status (`active`/`paid`/`defaulted`), issue/due/paid dates. | Implemented (schema) | `prisma/schema.prisma::Loan` |
| FR-LOAN-02 | Kolektibilitas (KOL) classification, 1–5, for portfolio risk / regulatory reporting. | Implemented (schema) | `Loan.kolClass`, default `1` |
| FR-LOAN-03 | Loan issuance workflow (approval, disbursement, first `Transaction`). | Planned | No service layer |
| FR-LOAN-04 | Repayment schedule and installment tracking. | Planned | No `RepaymentSchedule`-equivalent model exists yet |
| FR-LOAN-05 | Automatic or manual KOL reclassification based on days-past-due. | Planned | Flagged by `QA-INSTRUCTIONS.md` as a highest-risk area to test once built |

### 1.6 Transactions / ledger (`FR-TXN`)

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| FR-TXN-01 | Every ledger entry carries both `tenantId` and `unitId`, denormalized so isolation never depends on a join. | Implemented (schema) | `prisma/schema.prisma::Transaction` comment |
| FR-TXN-02 | A transaction links to at most one of a `SavingsAccount` or a `Loan` (or neither, e.g. a fee). | Implemented (schema) | `Transaction.savingsAccountId` / `loanId`, both optional |
| FR-TXN-03 | Transactions are debit/credit with an amount, description, and optional reference number. | Implemented (schema) | `Transaction.direction`, `amount`, `description`, `referenceNo` |
| FR-TXN-04 | Nothing currently writes a `Transaction` row — no service creates one. | Planned | Confirmed by absence of any module beyond `auth`/`tenants` in `apps/backend/src/modules/` |

### 1.7 Reports (`FR-RPT`)

| ID | Requirement | Status |
|---|---|---|
| FR-RPT-01 | Consolidated and per-unit financial statements. | Planned |
| FR-RPT-02 | SHU (sisa hasil usaha) distribution, computed per the basis noted in the `CooperativeUnit` schema comment (savings/loan volume for KSP-type units, purchase volume for Konsumen-type units). | Planned |
| FR-RPT-03 | PDF export of reports. | Planned — has an NFR gate already (`< 10s`, see §2.1) despite no implementation |
| FR-RPT-04 | Loan portfolio / KOL distribution report. | Planned |

### 1.8 Config (`FR-CFG`)

| ID | Requirement | Status |
|---|---|---|
| FR-CFG-01 | Tenant-level settings (fiscal year, SHU formula parameters, savings/loan product definitions). | Planned — no model, no route |

### 1.9 Platform Admin (`FR-PADM`)

| ID | Requirement | Status |
|---|---|---|
| FR-PADM-01 | Cross-tenant tenant list, activation/deactivation, subscription tier management for `super_admin`. | Planned — no model, no route |

### 1.10 Dashboard (`FR-DASH`)

| ID | Requirement | Status |
|---|---|---|
| FR-DASH-01 | Tenant-scoped summary view (members, savings totals, loan portfolio, recent activity). | Planned — `HomePage.tsx` currently only renders backend health-check status |

## 2. Non-functional requirements

### 2.1 Performance

| ID | Requirement | Source |
|---|---|---|
| NFR-PERF-01 | API responses < 500ms at p99. | `QA-INSTRUCTIONS.md`, `PM-INSTRUCTIONS.md` |
| NFR-PERF-02 | Dashboard loads in < 3s. | `QA-INSTRUCTIONS.md`, `PM-INSTRUCTIONS.md` |
| NFR-PERF-03 | Report PDF export completes in < 10s. | `QA-INSTRUCTIONS.md` |

No load testing or performance monitoring exists in the repo yet; these are acceptance gates for
QA sign-off, not currently measured.

### 2.2 Availability & resilience

| ID | Requirement | Source |
|---|---|---|
| NFR-AVAIL-01 | 99.5% uptime. | `PM-INSTRUCTIONS.md`, `OPS-INSTRUCTIONS.md` |
| NFR-AVAIL-02 | RTO < 1 hour. | `OPS-INSTRUCTIONS.md` |
| NFR-AVAIL-03 | RPO < 15 minutes. | `OPS-INSTRUCTIONS.md` |
| NFR-AVAIL-04 | Daily backups, with restore actually tested (not just scheduled). | `OPS-INSTRUCTIONS.md` |
| NFR-AVAIL-05 | Deploys flow `develop` → staging automatically; production ships only on a tagged release after QA sign-off. | `OPS-INSTRUCTIONS.md` |

None of the backup/restore/deploy-pipeline infrastructure exists in this repo yet — no
`docker-compose.staging.yml`/`docker-compose.prod.yml`, no backup scripts, no CD workflow beyond
the CI verification job (`.github/workflows/ci.yml`).

### 2.3 Security

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-SEC-01 | Every query touching tenant data filters by `tenantId` from `req.auth.tenantId` — never the request body or a URL param. | Implemented, standing rule | `CLAUDE.md` rule 1; enforced by convention + code review, not a framework guarantee |
| NFR-SEC-02 | At login, before `req.auth` exists, the tenant is resolved from the `Host` subdomain, never the request body. | Implemented | `tenant-host.ts::slugFromHost` |
| NFR-SEC-03 | Passwords are hashed with bcrypt (10 rounds), never stored or logged in plaintext. | Implemented | `service.ts` `BCRYPT_ROUNDS = 10` |
| NFR-SEC-04 | JWT secrets are never defaulted — signing with an empty string is refused. | Implemented | `service.ts::secret()` |
| NFR-SEC-05 | Money fields use `Decimal(18,2)`, never `Float`/`number`. | Implemented | `CLAUDE.md` rule 2; `prisma/schema.prisma` |
| NFR-SEC-06 | Standard security headers via `helmet`. | Implemented | `apps/backend/src/app.ts` |
| NFR-SEC-07 | CORS restricted to an explicit allow-list from `CORS_ORIGIN`. | Implemented | `apps/backend/src/app.ts` |
| NFR-SEC-08 | Secrets (`JWT_SECRET`, `DATABASE_URL`, etc.) come from env, never committed. | Implemented | `CLAUDE.md` rule 6; `.env` gitignored |
| NFR-SEC-09 | Rate limiting on auth endpoints (brute-force protection). | Planned | `ErrorCode.RATE_LIMIT` exists in the type system; nothing throws it yet |
| NFR-SEC-10 | Internal error details (stack traces, DB error text) never reach the client. | Implemented | `app.ts` error handler — only `AppError`/`ZodError` surface details |

### 2.4 Data isolation (multi-tenancy)

| ID | Requirement | Status |
|---|---|---|
| NFR-TENANT-01 | No API route may return or mutate a row belonging to a tenant other than `req.auth.tenantId`. | Standing rule, enforced by convention; flagged by QA as the top release-blocking risk category |
| NFR-TENANT-02 | Cross-tenant data leakage tests exist for every module before that module ships. | Partial — exists for auth/tenant provisioning (`tests/provision-tenant.test.ts`, `tests/tenant-host.test.ts`); not yet applicable to unbuilt modules |

### 2.5 Testability & code quality

| ID | Requirement | Status | Evidence |
|---|---|---|---|
| NFR-TEST-01 | Unit test coverage ≥ 80% lines (backend), enforced in CI. | Implemented | `vitest.config.ts`, currently 96.85% lines per `SETUP-VERIFICATION.md` |
| NFR-TEST-02 | Integration test coverage target ≥ 60%. | Target defined, not separately measured from unit coverage yet | `QA-INSTRUCTIONS.md` |
| NFR-TEST-03 | E2E test coverage target ≥ 40%. | Planned | No Playwright/e2e setup exists (`SETUP-VERIFICATION.md` "Known gaps") |
| NFR-TEST-04 | TDD: failing test written before implementation. | Standing rule | `CLAUDE.md` rule 4, "Definition of done" |
| NFR-TEST-05 | Lint clean, typecheck clean, before commit. | Implemented, CI-enforced | `.github/workflows/ci.yml` |
| NFR-TEST-06 | Integration tests run against a dedicated database (`siskop_test`), never the dev/demo database. | Implemented | `apps/backend/.env.test`, README setup steps |

### 2.6 Scalability

| ID | Requirement | Status |
|---|---|---|
| NFR-SCALE-01 | Baseline deployment: single VPS, Docker Compose, Nginx reverse proxy, PostgreSQL 15. | Baseline defined (`OPS-INSTRUCTIONS.md`), not yet built in this repo |
| NFR-SCALE-02 | Scale path: managed Postgres + object storage for report artifacts. | Documented direction, not implemented |

### 2.7 Localization & domain compliance

| ID | Requirement | Status |
|---|---|---|
| NFR-LOC-01 | Dates/numbers formatted for the `id-ID` locale. | Implemented where used | `SETUP-VERIFICATION.md` browser check; frontend date formatting |
| NFR-LOC-02 | Currency is Indonesian Rupiah throughout; no currency field exists because none is needed yet (single-currency assumption). | Implicit | `Decimal(18,2)` fields carry no currency code |
| NFR-LOC-03 | Kolektibilitas (KOL) classes 1–5 follow Indonesian cooperative/microfinance risk-classification convention. | Implemented (schema) | `Loan.kolClass` |

### 2.8 API contract

| ID | Requirement | Status |
|---|---|---|
| NFR-API-01 | Every response is `ApiResponse<T>` — `{ success, data?, error?, meta: { timestamp, requestId } }`. | Implemented | `packages/types/src/api.ts`, `app.ts` |
| NFR-API-02 | Errors use the `ErrorCode` enum; no ad-hoc string error codes. | Implemented | `packages/types/src/api.ts::ErrorCode` |
| NFR-API-03 | Request bodies validated with Zod at the route boundary before touching the DB. | Implemented | Every route in `modules/auth/routes.ts` |

## 3. Environment & technical constraints

| Constraint | Value |
|---|---|
| Node.js | 20 (CI), Node 24.14.0 verified locally |
| Package manager | pnpm 9 (workspaces + Turborepo) |
| Database | PostgreSQL 15, host port **5433** locally (5432 in CI — runners are clean) |
| Backend runtime | Express 4, TypeScript 5, Prisma 5 |
| Frontend runtime | React 18, Vite 5, Tailwind 3 |
| Browser support | Not formally specified; verified manually in current-channel Chrome only |
| Ports | Backend `3001`, frontend `3000` (Vite dev proxy forwards `/api` with `changeOrigin: false`, required — see `docs/04-System-Architecture-SISKOP.md` §5) |

## 4. Traceability

This document is the requirements source for QA acceptance criteria
(`docs/claude-integration/QA-INSTRUCTIONS.md`: "Write acceptance criteria in given/when/then")
and for Engineer API-contract design (`ENGINEER-INSTRUCTIONS.md`). When a requirement's status
changes, update its row here in the same PR/commit that changes the code — this document is meant
to stay accurate, not to be a point-in-time snapshot.

## 5. Related documents

- `docs/01-PRD-SISKOP.md` — product goals, users, scope
- `docs/03-ERD-SISKOP.md` — entity-relationship diagram
- `docs/04-System-Architecture-SISKOP.md` — system architecture
- `docs/05-DB-Schema-SISKOP.md` — database schema reference
