# Test Result — SISKOP QA Cycle 2 (2026-09-11)

| | |
|---|---|
| Executed by | QA Lead (Claude), per `docs/claude-integration/QA-INSTRUCTIONS.md` |
| Baseline | `main` @ `4c46ee0` — "feat: add Anggota mobile self-service portal (read-only)" |
| Previous cycle | Cycle 1, 2026-08-27, baseline `61cc34f` (`docs/09-QA-Test-Cases-SISKOP.md` §16) |
| Delta since Cycle 1 | Exactly one commit — `4c46ee0`. Nothing else in the codebase changed. |
| Companion documents | `Test cases.md`, `Bugs List.md` (this folder) |
| Environment | Backend `localhost:3001`, frontend `localhost:3000`, mobile `localhost:3002`, Postgres (Docker, host port 5433), tenants used: `demo` (accounting package), `barokah` (no package) |
| Methods used | (1) automated Vitest suite, (2) curl-driven live API execution against the running dev backend (Node's `fetch` still can't send a custom `Host` header — same constraint as Cycle 1), (3) source/schema review, (4) **Puppeteer-driven headless-Chrome UI walkthrough** — new this cycle; Cycle 1 had no UI automation tooling available |

## 0. Scope of this cycle

Because only one commit landed since Cycle 1's full 172-case execution, this cycle is **not** a
blind re-run of every case. Effort was allocated as:

1. Fresh entry-criteria run (lint/typecheck/build/test) against current `HEAD`.
2. **Full new-feature test pass** on the mobile Anggota self-service portal (`member-auth` +
   `member-portal` modules) — the only thing that changed, and previously 100% "Not executed"
   (TC-MOB-001..008 in Cycle 1) since no UI automation tooling existed then.
3. **Live re-verification** of all four Cycle 1 open defects (D1-D4) plus the informational D5,
   against current `HEAD`, to confirm none were silently fixed by unrelated refactors.
4. A small set of regression spot-checks on the highest-risk unchanged categories (cross-tenant
   isolation, dashboard) rather than re-running all 172 cases — the code behind them is byte-for-byte
   unchanged since Cycle 1's pass, so re-executing them provides no new information. Cycle 1's
   results for every unchanged area remain the authoritative record; see `Test cases.md` for the
   full case bank this cycle's cases were drawn from.

This is a deliberate scoping decision consistent with the test plan's regression strategy
(`docs/08-QA-Test-Plan-SISKOP.md` §3.1: "Regression — `pnpm run test` (full suite) + smoke
checklist, run before every release tag") rather than a shortcut — every case not re-executed live
this cycle is either (a) unchanged code already passing in Cycle 1, or (b) explicitly listed as a gap
in §6 below.

## 1. Entry criteria (test-plan §5.1)

| Check | Cycle 1 (2026-08-27) | Cycle 2 (2026-09-11) |
|---|---|---|
| `pnpm install` | Clean (mobile `node_modules` installed) | Clean — already installed |
| `pnpm run lint` | Green, 4 packages | **Green**, 5 packages (0 errors) |
| `pnpm run typecheck` | Green, 5 packages | **Green**, 5 packages (0 errors) |
| `pnpm run build` | Green | **Green** — backend/frontend/mobile all build |
| `pnpm run test` (backend) | 217/217 tests, 16 files, 93.41% lines | **233/233 tests, 18 files, 93.19% lines** (≥80% gate met) |
| Frontend/mobile automated tests | None exist (NFR-TEST-07) | Still none — unchanged gap |

The two new test files are `tests/member-auth.test.ts` (11 tests) and `tests/member-portal.test.ts`
(4 tests), plus 26 new assertions folded into the existing `tests/members.test.ts` — all shipped
alongside the mobile-portal feature commit itself, not written by QA.

**Windows coverage-run note (carried forward from Cycle 1):** the first `vitest run --coverage`
attempt crashed with a segmentation fault under default heap size — same environment issue Cycle 1
documented, not a product defect. Re-running with `NODE_OPTIONS=--max-old-space-size=6144` completed
cleanly. Worth formalizing into `apps/backend/package.json`'s test script so it isn't rediscovered
every cycle.

**Test data note:** the shared `demo` dev database still carries QA-created residue from prior
sessions (members named "QA NIK Original" / "QA Smoke Test Member" / "QA Forged Tenant Member";
inactive tenants `qa-email-*`, `smoketest*`) predating this cycle. Not investigated further — flagged
here only so it isn't mistaken for new pollution. This cycle's own test data (3 members: "QA Cycle2
Portal Test", "QA Cycle2 Portal Test B", "QA Cycle2 D1 Retest"; 1 tenant:
`qa-cycle2-dup-admin-test`) was cleaned up immediately after use — members soft-deactivated via
`DELETE /api/members/:id`, the duplicate tenant deactivated via `PUT /api/platform/tenants/:id`
(`isActive:false`) using the seeded `superadmin@siskop.com` platform account. The two extra Pokok
saving rows created to reproduce D2/D3 were left in place under the now-deactivated test member,
since deleting ledger rows would itself violate the no-raw-DB-hacks practice this project follows.

## 2. Defect re-verification (carried forward from Cycle 1)

All four Cycle 1 defects were re-tested live against current `HEAD`, plus D5 was re-measured. None
were touched by the mobile-portal commit (it doesn't modify `savings/`, `loans/`, or the tenant
registration path), so this is confirmatory, not exploratory.

| ID | Cycle 1 result | Cycle 2 result | Evidence |
|---|---|---|---|
| D1 | Live FAIL | **Live FAIL — still open** | Fresh member, no Pokok → `POST /api/savings` (Wajib config) → `201`, not rejected |
| D2 | Live FAIL | **Live FAIL — still open** | Pokok saving, balance 750,000, no active loan → withdraw 750,000 → `201`, balance reaches exactly 0 |
| D3 | Live FAIL | **Live FAIL — still open** | Same member, same Pokok config, opened a 2nd time → `201`, not `409`. Also visually confirmed in the mobile portal — see §3 |
| D4 | Live FAIL | **Live FAIL — still open** | New tenant registered reusing `admin@demo.com` as `adminEmail` → `201`, not `409` |
| D5 | Live FAIL (informational) | **Live FAIL (informational) — still open** | Login: 787/816/892ms across 3 fresh samples (Cycle 1: 860-923ms). `GET /api/members`: ~18ms — isolates the cost to the login path |

Source review confirms why: `savings/service.ts::createSaving` still never calls `hasPokokSaving()`;
`withdrawFromSaving`'s only Pokok guard is still the active-loan check; the `Saving` model still has
no uniqueness constraint beyond non-unique indexes; `registerTenant`'s uniqueness check is still a
caught `P2002` on a per-tenant-scoped `@@unique([tenantId, email])`, which a cross-tenant email
collision can never trigger. Full detail and file:line citations in `Bugs List.md`.

## 3. New-feature pass: Mobile Anggota self-service portal

This is the entire code delta since Cycle 1, and Cycle 1 explicitly could not test it (no UI
automation tooling existed then — TC-MOB-001..008 were all "Not executed"). This cycle used
Puppeteer (already an `apps/backend` devDependency, used for real PDF-export tests, per
`docs/09-QA-Test-Cases-SISKOP.md`'s own note that it was available but only usable for one-shot
Chrome-CLI screenshots last cycle) to drive an actual authenticated multi-step walkthrough for the
first time.

| Area | Result | Evidence |
|---|---|---|
| Member login (correct credentials) | **PASS** | Live API + UI: `POST /api/member-auth/login` with NIK+password → `200`, session issued; mobile UI `/anggota/login` → redirects to `/anggota/dashboard` |
| Member login (wrong password) | **PASS** | `401 UNAUTHORIZED`, generic message — no user-enumeration difference observed |
| Password derivation matches spec | **PASS** (mechanically) / **See D6** (security concern) | `activatePortalAccess` returned `defaultPassword: "15051999"` for `birthDate: 1999-05-15` — correct `DDMMYYYY`. **However** this exact value is also mechanically decodable from the member's NIK alone per Indonesia's standard NIK encoding — see D6 in `Bugs List.md` |
| `mustChangePassword` flag returned correctly | **PASS** (flag itself) / **FAIL — D6** (not enforced) | Flag is `true` after activation, `true` in login/`/me` responses, flips to `false` after a successful password change — but **nothing blocks data access while `true`**, confirmed live: dashboard/savings/loans all returned real data with `mustChangePassword: true` still active |
| Change-password flow | **PASS** | `PUT /api/member-auth/me/password` with correct current password → `200`; old (default) password rejected immediately after; new password logs in successfully; `mustChangePassword` flips to `false` |
| Wrong-current-password on change | **PASS** | `401`, password not changed (implied by old password still failing on next login attempt only after a *successful* change — separately confirmed via source review of `changeMemberPassword`) |
| Ownership isolation (Member A → Member B's saving id) | **PASS** | `GET /api/member/savings/:id` for another member's saving id → `404 NOT_FOUND` ("Rekening simpanan tidak ditemukan"), not `403` — correctly avoids confirming the id's existence, matches the documented `assertOwnsMember` design intent |
| Cross-session-type rejection (staff token → member-portal route) | **PASS** | Staff Bearer token against `GET /api/member/dashboard` → `401` |
| Cross-session-type rejection (member token → staff route) | **PASS** | Member Bearer token against `GET /api/members` → `401` |
| Cross-tenant NIK scoping | **Automated PASS** (not re-run live) | `member-auth.test.ts` "scopes login by tenant even when two members in different tenants share a NIK" — shipped with the feature; not independently re-verified live this cycle (time-boxed; low risk given the `tenantId_nik` compound-unique lookup design) |
| `passwordHash` never on the wire (members list/detail) | **PASS** | Live `GET /api/members` response keys enumerated — no `passwordHash` field present. This was a bug the same commit fixed (see commit message); confirmed the fix holds |
| Mobile UI: member dashboard renders real data | **PASS** | Screenshot: shows "Halo, QA Cycle2 Portal Test", correct member id, "Total Simpanan Rp 100rb" (2 accounts) — the totals visually corroborate D2 (Pokok drained to 0) and D3 (duplicate Pokok) simultaneously: one account shows Rp 100rb, the other Rp 0, both "Aktif" |
| Mobile UI: member savings list renders real data | **PASS** | Screenshot: both Pokok rows visible with correct individual balances |
| Mobile UI: unauthenticated direct-URL access to `/anggota/dashboard` | **PASS** (after retest) | First attempt gave a false positive (same Puppeteer browser context inherited `localStorage` from a prior logged-in tab — a test-harness artifact, not a product bug). Retested with a genuinely isolated `browser.createBrowserContext()` → correctly redirected to `/anggota/login` |
| Staff-side activation UI (`MemberDetailPage`) | **Code-reviewed PASS** | Confirmed via source read: displays `defaultPassword` and NIK together for staff to relay to the member, with copy stating the change is mandatory ("Anggota wajib mengganti kata sandi saat login pertama") — this claim is what D6 shows to be false in practice |
| Member logout / refresh-cookie separation from staff | **Code-reviewed PASS** | Distinct cookie name (`siskop_member_refresh_token`) and path (`/api/member-auth`) from the staff refresh cookie; distinct JWT claims shape (`memberId`/`role:"member"` vs `userId`/`role:"tenant_admin"`) rejected by each other's schema validators — not independently exercised live this cycle |

**Net new defect from this pass: D6 (P0)** — see `Bugs List.md` for full repro and impact. This is
the headline finding of Cycle 2.

## 4. Regression spot-checks (unchanged code, quick re-confirmation only)

| Check | Result |
|---|---|
| Cross-tenant isolation: `barokah` token reading a `demo` member id | **PASS** — `404`, not found |
| Dashboard summary loads with coherent real aggregates | **PASS** — `200`, non-zero real totals |
| `demo`/`barokah` login still resolve to the correct tenant via `Host` subdomain | **PASS** (used continuously throughout this cycle's testing) |

Everything else in the 172-case Cycle 1 bank (Members, Loans, Accounting, Reports, Config, Platform
Admin, RBAC, full 8-case Multi-Tenant Isolation battery, API/Security NFRs) is **unchanged code** —
Cycle 1's results stand. See `docs/09-QA-Test-Cases-SISKOP.md` §16.3 for that full record; `Test
cases.md` in this folder reproduces the case definitions (without re-stating Cycle 1's per-case
results) for a single up-to-date case bank going forward.

## 5. Non-functional spot checks

| Check | Result |
|---|---|
| NFR-PERF-01 (API p99 <500ms) | Login ~790-890ms — **fails**, informational (D5, unchanged). List members ~18ms — **passes** |
| NFR-PERF-02 (dashboard <3s) | Not independently timed this cycle (API response itself is fast; full browser paint time not instrumented) |
| NFR-PERF-03 (PDF export <10s) | Not exercised this cycle — no report/PDF code changed since Cycle 1 |

## 6. What this cycle did not cover

- **Cross-tenant NIK-sharing scenario** for member-auth — automated-only, not independently
  re-verified live (§3).
- **Member refresh-token / logout mechanics** — code-reviewed only, not exercised live end-to-end.
- **KTP upload, Decimal-precision repeated-fraction test, multi-unit consolidated reporting** — same
  gaps Cycle 1 carried forward (`docs/09-QA-Test-Cases-SISKOP.md` §16.4); still open, unrelated to
  this cycle's delta.
- **Full RBAC/nav-visibility walkthrough on desktop and mobile staff views** — now technically
  possible with Puppeteer (proven working this cycle), but out of scope for this cycle's time budget
  since none of that surface changed. Worth doing in a cycle where UI automation coverage itself is
  the objective, or wiring the driver scripts into a proper `apps/*/e2e` suite rather than one-off
  scratch scripts.
- **Statistical timing-attack analysis** on the unknown-email/wrong-password paths — single manual
  samples only, same caveat as Cycle 1.

## 7. Exit criteria assessment (test-plan §5.2)

| Gate | Threshold | Actual | Met? |
|---|---|---|---|
| Backend unit coverage | ≥80% lines | 93.19% | ✅ |
| P0/P1 defects | Zero open | **4 open P0 (D1, D2, D3, D6), 1 open P1 (D4)** | ❌ |
| Cross-tenant leakage cases | 100% pass, no exceptions | Spot-checked this cycle, full 8/8 battery unchanged since Cycle 1's 100% pass | ✅ |
| CI pipeline (lint/typecheck/test/build) | Green | Green | ✅ |
| NFR-PERF-01 | p99 <500ms | Login ~790-890ms (D5, informational) | ⚠️ |
| NFR-PERF-02/03 | <3s / <10s | Not measured this cycle | — |

## 8. Go/No-Go recommendation

**No-Go.** Unchanged from Cycle 1's own conclusion, and now reinforced by a new P0: D1-D3
(Pokok-integrity / money-arithmetic) remain exactly as release-blocking as they were on 2026-08-27,
and D6 (mobile-portal auth bypass exposing real balances) is a fresh P0 in the exact same
"auth bypass / unauthorized visibility into real money data" category that made Cycle 1 a No-Go.

Per test-plan §3.3: *"A single failed cross-tenant-isolation or money-arithmetic test case is
release-blocking regardless of severity elsewhere."* D6 extends that same principle to the new
member-facing surface — a member's own balance data being readable by someone who isn't that member,
without ever compromising a real secret, is the same class of failure.

**Suggested path back to Go** (extends Cycle 1's suggested path in
`docs/09-QA-Test-Cases-SISKOP.md` §16.6, now with the mobile-portal item added):

1. Fix D1-D3 in `savings/service.ts` (call `hasPokokSaving()` from `createSaving`; add a Pokok-floor
   check to `withdrawFromSaving`; add a uniqueness constraint or application check against duplicate
   savings).
2. Fix D4 in `auth/service.ts::registerTenant` (explicit cross-tenant admin-email pre-check).
3. Fix D6: enforce `mustChangePassword` server-side on every `/api/member/*` read, and have
   Engineer/PM decide on hardening the default-password derivation itself (see `Bugs List.md` D6 for
   two independent options).
4. Re-run the Savings section and the full mobile-portal section of this suite.
5. Correct the FR statuses in `docs/02-System-Requirements-SISKOP.md` for FR-SAV-02/05/06,
   FR-AUTH-02, and whichever mobile FR covers first-login password enforcement, in the same PR as
   each fix (per test-plan §10/§11 traceability requirement).

Per `CLAUDE.md`'s decision-authority table, defect fixes are Engineer's call, but the QA go/no-go
gate on money-correctness and auth-bypass categories is a QA decision PM cannot override.
