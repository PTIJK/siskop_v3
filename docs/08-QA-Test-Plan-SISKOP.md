# 08 — QA Test Plan: SISKOP

| | |
|---|---|
| Status | Draft for review — first formal test plan for this repo |
| Owner | QA Lead |
| Applies to | `apps/backend`, `apps/frontend`, `apps/mobile`, `packages/types` |
| Baseline | `main` @ commit `61cc34f`, 2026-08-27 |
| References | `CLAUDE.md`, `docs/claude-integration/QA-INSTRUCTIONS.md`, `docs/02-System-Requirements-SISKOP.md` (FR/NFR register), `docs/01-PRD-SISKOP.md` |
| Companion document | `docs/09-QA-Test-Cases-SISKOP.md` |

`QA-INSTRUCTIONS.md` names this file `QA-TEST-PLAN.md` as QA's reference document; it did not
exist in the repo before this plan. This is that document — going forward, keep it in sync with
`docs/02-System-Requirements-SISKOP.md` in the same PR that changes scope or status.

## 1. Objectives

1. Verify every **Implemented** functional requirement in `docs/02-System-Requirements-SISKOP.md`
   behaves per its acceptance criteria, across positive and negative paths.
2. Close the highest-risk gap named in `QA-INSTRUCTIONS.md`: **cross-tenant data leakage** — every
   module must prove it cannot read or mutate another tenant's rows.
3. Verify money-correctness: savings balance arithmetic, loan amortization/margin calculation, KOL
   reclassification, double-entry journal balancing, and regulatory report totals.
4. Establish go/no-go acceptance criteria the QA Lead can apply consistently release over release.
5. Make explicit what is **not** covered yet (rate limiting, frontend automated tests, e2e
   automation, package-quota enforcement) so those gaps are a tracked risk acceptance, not a blind
   spot.

## 2. Scope

### 2.1 In scope

| Area | Component |
|---|---|
| Auth & tenant provisioning | `apps/backend/src/modules/auth`, `modules/tenants/provision.ts` |
| Multi-unit cooperative model | `CooperativeUnit`, unit resolution |
| Members | `modules/members` |
| Savings | `modules/savings`, `SavingConfig` |
| Loans | `modules/loans`, `LoanConfig`, KOL classification |
| Accounting / ledger | COA, account mappings, journal posting, SHU distribution |
| Reports | Financial, RAT, 5 regulatory reports (Neraca, Arus Kas, Laba Rugi, Pembagian SHU, CALK), PDF export |
| Config | Units, Roles, Users, Whitelabel, Modal Disetor |
| Platform Admin | Cross-tenant tenant/package/admin-user management |
| Dashboard | Tenant-scoped summary |
| Mobile (Fase 1) | Read-only Dashboard/Members/Savings/Loans/Reports + Profil, permanent Anggota Menunggak |
| Cross-cutting | Multi-tenant isolation, RBAC (4 seed roles + platform admin), SaaS entitlements, API envelope/error contract |

### 2.2 Out of scope for this cycle

| Item | Reason |
|---|---|
| Password reset / email verification (FR-AUTH-10) | Planned, not built |
| Rate limiting on auth endpoints (NFR-SEC-09) | `ErrorCode.RATE_LIMIT` exists but nothing throws it — no brute-force protection to test yet. **Tracked as an open security risk**, see §7. |
| Package quota enforcement — `maxUsers`/`maxMembers`/`maxSavingConfigs` (NFR-SAAS-03) | Columns exist, no middleware reads them |
| Platform notification center (FR-PADM-08) | Schema only, no route |
| Loan portfolio/KOL standalone report (FR-RPT-06) | Not built; KOL only surfaces via Overdue-members view |
| Backup/restore, deploy pipeline (NFR-AVAIL-*) | Infra not built in this repo |
| Load/performance testing infrastructure | No tooling exists yet; NFR-PERF-* remain manual spot-checks this cycle |

## 3. Test Strategy

### 3.1 Levels

| Level | Owner | Tooling | Current state |
|---|---|---|---|
| Unit | Engineer, reviewed by QA | Vitest, backend only | 93.43% line coverage, 209 tests / 16 files (`apps/backend/tests`) |
| Integration | Engineer + QA | Vitest against `siskop_test` DB (`apps/backend/.env.test`) | Same suite as unit; DB truncated between tests — see `helpers.ts` |
| Manual functional / exploratory | QA | Browser (frontend + mobile), Postman/curl (API) | Primary method for frontend and mobile — no RTL/Vitest suite on either app (NFR-TEST-07) |
| E2E | QA | None automated | Ad-hoc Puppeteer script (reused from PDF-export tooling) driven manually per change |
| Security / multi-tenancy | QA, escalate to Engineer | Manual + integration tests | Every module test file already asserts a cross-tenant-leak case; QA manual pass re-verifies via the UI/API with two live tenants |
| Regression | QA | `pnpm run test` (full suite) + smoke checklist (§6) | Run before every release tag |

Because the frontend and mobile apps have **no automated test coverage** (NFR-TEST-07), functional
QA for `apps/frontend` and `apps/mobile` is manual for this cycle — test cases in the companion
document are written as manual step-by-step scripts, not just API assertions. Do not report a
frontend feature as verified from a passing backend unit test alone.

### 3.2 Test types

- **Functional** — every FR row in `docs/02-System-Requirements-SISKOP.md` marked "Implemented".
- **Negative / boundary** — invalid input, missing preconditions, business-rule violations (see
  Zod schemas cited per module in the test-case doc for exact boundaries).
- **Multi-tenant isolation** — Tenant A must never read/mutate Tenant B's rows, via API directly
  (not just hidden by the UI).
- **RBAC / authorization** — the 4 seed roles (Super Admin, Manager, Teller, Viewer) and the
  separate `super_admin` platform axis (`NFR-SEC-11`) each see only what their permission matrix
  allows.
- **Entitlement / SaaS packaging** — accounting-gated features (COA, mappings, regulatory reports)
  and whitelabel behave correctly for tenants with/without the entitlement, including
  `packageId: null` (NFR-SAAS-01).
- **Data-correctness** — Decimal arithmetic on balances/principal, journal double-entry balancing,
  KOL day-past-due thresholds, report totals reconciling to ledger.
- **API contract** — `ApiResponse<T>` envelope shape and `ErrorCode` usage on every endpoint
  (NFR-API-01/02).
- **Non-functional spot checks** — response latency, dashboard load time, PDF export time, security
  headers/CORS, manual only (no monitoring harness exists).

### 3.3 Risk-based prioritization

Per `QA-INSTRUCTIONS.md`, these four are tested first and block release on any failure:

1. **Cross-tenant data leakage** — any module, any endpoint.
2. **Savings balance arithmetic** — deposit/withdrawal correctness, Pokok withdrawal lock,
   Pokok-before-other-products gate.
3. **KOL reclassification** — days-past-due thresholds driving `kolCategory` transitions.
4. **Report totals** — regulatory reports reconciling to underlying `JournalLine` postings; date-range
   inclusivity (FR-RPT-07 — the historical bug class where same-day rows silently vanish).

Risk matrix for prioritizing everything else:

| Priority | Criteria | Examples |
|---|---|---|
| P0 — blocker | Data loss/corruption, cross-tenant leak, money miscalculation, auth bypass | Tenant B sees Tenant A's members; balance goes negative incorrectly; JWT accepted with empty secret |
| P1 — critical | Core workflow broken, no workaround | Cannot disburse a loan; PDF export fails; login broken for a valid user |
| P2 — major | Feature degraded, workaround exists | Wrong empty-state message; pagination off-by-one; entitlement banner text wrong |
| P3 — minor | Cosmetic, non-blocking | Spacing, non-critical `id-ID` formatting inconsistency |

## 4. Test Environment

| | |
|---|---|
| Backend | Express 4 / Node 20+ on port `3001` |
| Frontend | Vite dev server, port `3000`, bound `0.0.0.0` (never rely on `localhost` resolving — see `CLAUDE.md`) |
| Mobile | Separate Vite app under `apps/mobile` |
| Database | PostgreSQL 15. Local dev: host port **5433**. CI/integration tests: `siskop_test`, port 5432 in CI, 5433 locally per `.env.test`. **Never point manual QA at the demo/dev DB's data expecting it to survive** — `siskop_test` is truncated between automated test runs. |
| Tenant fixtures | Multi-tenant test requires ≥2 live tenants with distinct subdomains (e.g. `demo.localhost:3000`, a second seeded tenant) to exercise `Host`-based tenant resolution and cross-tenant checks |
| Roles for RBAC pass | One user per seed role (Super Admin, Manager, Teller, Viewer) per test tenant, plus one Platform Admin account outside any tenant context |
| Browser | Current-channel Chrome (only browser formally verified per `docs/02-System-Requirements-SISKOP.md` §3) |
| Dev proxy constraint | `changeOrigin: false` must hold in `apps/frontend/vite.config.ts` — if flipped to `true`, tenant subdomain resolution breaks silently and every login-related test will misattribute tenant. Confirm this config is unchanged before a test cycle if login/tenant issues appear. |

## 5. Entry / Exit Criteria

### 5.1 Entry criteria (per test cycle)

- Feature branch merged to `develop` (or release candidate cut).
- `pnpm run lint`, `pnpm run typecheck`, `pnpm run test`, `pnpm run build` all green in CI.
- `docs/02-System-Requirements-SISKOP.md` updated for any FR whose status changed in this cycle.
- Test data/fixtures available (≥2 tenants, all 4 seed roles, 1 platform admin).

### 5.2 Exit criteria (release go/no-go — QA Lead decision, per `CLAUDE.md`/`QA-INSTRUCTIONS.md`)

| Gate | Threshold |
|---|---|
| Backend unit coverage | ≥ 80% lines (CI-enforced; currently 93.43%) |
| Integration coverage | ≥ 60% (tracked qualitatively — same suite as unit; not separately measured) |
| E2E / manual functional coverage | ≥ 40% of critical user journeys walked manually each release |
| P0/P1 defects | Zero open |
| P2 defects | Documented and accepted by PM, or fixed |
| Cross-tenant leakage cases | 100% pass — no exceptions, no PM override (`QA-INSTRUCTIONS.md`: "PM cannot override a failed AC" for these) |
| NFR-PERF-01 | API p99 < 500ms (spot-checked manually this cycle) |
| NFR-PERF-02 | Dashboard loads < 3s |
| NFR-PERF-03 | PDF export < 10s |
| CI pipeline | Green on the release commit |

A single failed cross-tenant-isolation or money-arithmetic test case is release-blocking regardless
of severity elsewhere, per the risk-based prioritization in §3.3.

## 6. Regression smoke checklist (run every release, in addition to full case list)

1. Register a new tenant → login on its subdomain → dashboard loads.
2. Create a member → open Simpanan Pokok → deposit → withdraw partially → attempt to zero it out
   (must be rejected, `CANNOT_WITHDRAW_POKOK`).
3. Attempt to open a Wajib/Sukarela saving or a loan for a member with no active Pokok (must be
   rejected, `MEMBER_HAS_NO_POKOK_SAVING`).
4. Disburse a loan → verify journal entry posted → record a payment → verify `remainingAmount`
   decreases and KOL stays `LANCAR`.
5. Push a loan past due → verify KOL reclassifies automatically.
6. Generate each of the 5 regulatory reports for a date range spanning "today" → verify today's
   transactions appear (FR-RPT-07 regression) → export PDF, confirm it completes and opens.
7. As a second tenant's user, confirm none of tenant 1's members/savings/loans/reports are visible
   via UI or direct API calls with tenant 1's IDs substituted.
8. Log in as each of the 4 seed roles → confirm nav/actions match their permission matrix (§3.2 in
   `docs/02-System-Requirements-SISKOP.md`, Manager cannot edit Config, Teller cannot see Reports
   config, Viewer is read-only everywhere).
9. Log in as Platform Admin → confirm confinement to `/platform/*`, cannot browse into any tenant
   module by direct URL.
10. Remove/never-assign a `SubscriptionPackage` on a test tenant → confirm COA/mappings/regulatory
    reports/whitelabel-write are blocked with `FEATURE_NOT_ENTITLED`, not silently empty.
11. Mobile: log in on `apps/mobile`, confirm Dashboard/Members/Savings/Loans/Reports render
    read-only and Anggota Menunggak is reachable without an accounting entitlement.

## 7. Known risk acceptances (carried forward each cycle until closed)

| Risk | Impact if exploited/hit | Current mitigation | Status |
|---|---|---|---|
| No rate limiting on login (NFR-SEC-09) | Brute-force credential stuffing against a known tenant subdomain | Same-timing dummy-hash comparison on unknown email (FR-AUTH-05) reduces enumeration, not brute force | Open — escalate to Engineer/Ops per `QA-INSTRUCTIONS.md` "you escalate: security findings" |
| No frontend/mobile automated tests (NFR-TEST-07) | Regressions in UI ship undetected until manual QA or a user reports them | Manual functional pass every release (this plan, §3.1/§6) | Open, accepted for this cycle |
| Package quotas unenforced (NFR-SAAS-03) | A tenant can exceed `maxUsers`/`maxMembers`/`maxSavingConfigs` with no block | None | Open, low severity (no financial/data-integrity impact) |
| No load testing | NFR-PERF-* thresholds unverified under concurrent load | Manual single-user spot checks only | Open — recommend before first paying multi-tenant cohort at scale |

## 8. Roles & Responsibilities

Per `CLAUDE.md` and `docs/claude-integration/*`:

- **QA Lead** — owns this plan, writes acceptance criteria (given/when/then), executes/coordinates
  test cases, decides release go/no-go. Can block a release; PM cannot override a failed AC.
- **Engineer** — fixes defects, maintains the automated backend suite, keeps
  `docs/02-System-Requirements-SISKOP.md` current with code changes.
- **PM** — scope and priority calls on non-blocking (P2/P3) defects; cannot override failed
  cross-tenant/money-correctness ACs.
- **Ops** — infrastructure, deploy pipeline, backup/restore (currently not built — §2.2).
- Escalation: highest-authority agent for the affected area decides within 24h; no consensus
  required.

## 9. Deliverables

- This test plan (`docs/08-QA-Test-Plan-SISKOP.md`).
- Test case document (`docs/09-QA-Test-Cases-SISKOP.md`) — positive/negative cases per module,
  traceable to FR/NFR IDs.
- Per-release: smoke checklist results, defect log, coverage report (`apps/backend/coverage`),
  go/no-go decision record.

## 10. Defect Severity/Priority Definitions

Uses the same P0–P3 scale as §3.3. Every defect logged against a test case must cite the
**TC ID** and **FR/NFR ID** it violates, so `docs/02-System-Requirements-SISKOP.md` status can be
corrected in the same fix PR if the requirement was mis-scoped rather than mis-implemented.

## 11. Traceability

Every test case in the companion document maps to one or more FR/NFR IDs from
`docs/02-System-Requirements-SISKOP.md`. When that document's status for a requirement changes,
review whether the corresponding test cases need updating in the same PR.
