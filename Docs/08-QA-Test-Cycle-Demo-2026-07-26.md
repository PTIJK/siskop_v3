# QA Test Cycle — Pre-Demo Regression (2026-07-26)

Test cycle executed ahead of the 2026-07-26 evening product demo. Covers both the
**test plan** (scope, strategy, environment, entry/exit criteria) and the **execution
results** (what was actually run, defects found, fixes applied) for this single cycle.
Not a permanent architecture doc — see `01-PRD-SISKOP.md` / `02-FSD-SISKOP.md` /
`04-System-Architecture-SISKOP.md` for that. Safe to archive once the demo has passed.

## 1. Objective

Verify the current `main` branch is stable enough to demo live tonight, and fix any
defect that would visibly break or embarrass the demo, prioritizing the regulatory
financial reporting module (Neraca/Arus Kas/Laporan Hasil Usaha/SHU/CALK) as the most
recently built, most feature-dense area.

## 2. Scope

**In scope:** auth/login (tenant + platform admin), dashboard, members, savings, loans
(incl. KOL categories), regulatory financial reports + PDF export, Konfigurasi Akun
(COA + mappings), multi-tenant isolation, package entitlement gating, platform-admin
console.

**Out of scope (explicitly not attempted this cycle, flagged as residual risk in §7):**
load/performance testing, security penetration testing, cross-browser testing (Chromium
only), mobile/responsive layout, email/SMTP notification delivery, Google SSO, LPEA
report (not yet built — pre-existing roadmap item, unrelated to tonight).

## 3. Environment

| Component | Detail |
|---|---|
| Backend | `ts-node-dev`, port 3001, `NODE_ENV=development` |
| Frontend | Vite dev server, port 5180, proxies `/api` → 3001 |
| Database | PostgreSQL 16 (docker container `siskop_db`), port 5433, **existing** dev data — not reset |
| Tenants | `demo` (Koperasi Demo Sejahtera, Konvensional, **accounting entitled**), `barokah` (Koperasi Syariah Barokah, Syariah, **not** accounting-entitled) |
| Demo tenant login | `admin@demo.com` / `Admin123!` |
| Barokah tenant login | `admin@barokah.com` / `Admin123!` |
| Platform admin login | `superadmin@siskop.com` / `SuperAdmin123!` via `admin.localhost:5180` |

A full `pg_dump` snapshot of the working database was taken at three checkpoints during
this cycle and left inside the `siskop_db` container at `/tmp/backup/`:
`siskop_dev_pre_test.dump` (before any testing), `siskop_dev_pre_backfill.dump` (before
the journal backfill in §6.1), `siskop_dev_good_demo_state.dump` (final good state, after
all fixes below — **this is the one to restore from if something goes wrong before the
demo**). Restore with:
```bash
docker exec siskop_db pg_restore -U siskop -d siskop_dev --clean --if-exists --no-owner \
  --role=siskop /tmp/backup/siskop_dev_good_demo_state.dump
```

## 4. Strategy

Given the same-day time budget, testing was risk-prioritized rather than exhaustive:

1. **Automated regression first** — run the existing suites to establish a trustworthy
   baseline before spending time on manual exploration.
2. **API-level smoke test** of every route in `docs/api-conventions.md` for the primary
   demo tenant, using curl against the real running server (not mocks).
3. **UI-level smoke test** driving a real headless Chromium (Playwright) through the
   actual login flow and every page in the demo's likely click-path, screenshotting each
   and asserting zero console/page errors — this is the only layer that catches
   rendering bugs, since the frontend has no automated test suite of its own (see §7).
4. **Data-integrity spot check** on the regulatory reports specifically, since they are
   computed (double-entry ledger aggregation), not simple CRUD — a subtle bug here
   produces numbers that look plausible but are wrong, which automated route-exists
   checks can't catch. This is what surfaced the two real defects in §6.2 and §6.3.
5. Fix defects found, immediately re-verify with the same reproduction script, then
   re-run the full automated suite to confirm no regression.

## 5. Entry / Exit Criteria

**Entry:** `main` branch, working tree clean apart from two pre-existing untracked docs.

**Exit (all met — see §6 for evidence):**
- [x] Backend automated suite: 100% pass
- [x] `tsc --noEmit` clean, backend and frontend
- [x] Production frontend build succeeds
- [x] Every documented tenant + platform-admin API route smoke-tested, 200/expected status
- [x] Primary demo tenant's regulatory reports numerically self-consistent (Neraca
      balanced, Arus Kas ending balance matches Neraca cash, SHU distribution populated)
- [x] UI smoke test of full demo click-path, zero unexpected console/page errors
- [x] All defects found are either fixed-and-reverified, or documented as an accepted
      residual risk with a demo-script mitigation (§7)

## 6. Execution Results

### 6.1 Automated suites

| Suite | Result |
|---|---|
| Backend Jest (`apps/backend`, 16 suites) | **182/182 passed** |
| Backend `tsc --noEmit` | Clean |
| Frontend `tsc --noEmit` | Clean |
| Frontend `vite build` (production) | Succeeds (1 non-blocking chunk-size warning, pre-existing) |
| `eslint` (both apps) | **Could not run** — no `eslint` package or config in either app; pre-existing gap, not introduced this cycle. Not a functional risk; recommend fixing post-demo. |

### 6.2 API smoke test (curl, `demo` tenant)

All 25 documented tenant routes returned the expected `success:true` / status, including
dashboard (summary/loan-chart/payment-chart), members, savings (+configs), loans
(+configs, +overdue), config (profile/users/roles/whitelabel/accounts/account-mappings
+completeness/shu-distribution/modal-disetor), and all 5 regulatory report GETs
(financial, rat, neraca, arus-kas, laporan-hasil-usaha, shu-distribution, calk). All 6
PDF export endpoints (neraca, arus-kas, laporan-hasil-usaha, shu-distribution, financial,
rat) returned `Content-Type: application/pdf` with a valid `%PDF` header.

Platform admin routes (tenants, notifications, notifications/unread-count, users,
packages) all verified 200 via `superadmin@siskop.com`.

Multi-tenant entitlement isolation verified: `barokah` (no `accounting` module) correctly
gets `403 FEATURE_NOT_ENTITLED` on `/api/config/accounts` and
`/api/reports/regulatory/neraca`, while its dashboard/members remain fully functional.

### 6.3 Defects found and fixed

**BUG-1 — Demo seed data: 31 savings transactions never posted to the ledger (High).**
`prisma/seed-demo-transactions.mjs` creates all `demo` tenant savings deposits/withdrawals
*before* wiring the account mappings later in the same script. The journal engine
(`apps/backend/src/lib/journal.ts`) correctly no-ops (stores an `UNPOSTED_MISSING_MAPPING`
entry) when a mapping doesn't exist yet at post time — by design, so it never blocks the
underlying transaction — but nothing ever went back and backfilled those 31 entries once
the mappings existed. Effect: Neraca showed Kas at **-Rp 23,521,918** and Simpanan
Pokok/Wajib/Sukarela all at **Rp 0**, despite ~30 real deposits existing — a bug that would
have been highly visible and hard to explain live, since the regulatory-reporting module
is this session's headline feature.
*Fix:* wrote a one-off backfill (not committed — a data operation, not a code change) that
found all `UNPOSTED_MISSING_MAPPING` `JournalEntry` rows for `SAVING_TRANSACTION`, looked up
the now-existing `AccountMapping`, and posted the missing `JournalLine` pairs. 31/31 fixed.
Verified: Simpanan Pokok Rp 5,000,000 (10×500k ✓), Simpanan Wajib Rp 2,950,000 ✓, Simpanan
Sukarela Rp 10,800,000 ✓ — all reconcile exactly against the seed script's own numbers.

**Data-realism follow-up (not a code bug):** after BUG-1's fix, Kas was still negative
(-Rp 4,771,918) because the seed script disburses more in loans (Rp 28,000,000) than the
cooperative had actually collected. Per your direction, added one legitimate top-up
deposit (Rp 10,000,000, Rahmat Hidayat's Simpanan Sukarela, via the real `/api/savings/:id/deposit`
endpoint — not a manual ledger hack) to bring Kas to a healthy **+Rp 5,228,082**. Neraca,
Arus Kas, and SHU distribution all reconcile correctly against this final state.

**BUG-2 — Rate limiter would strand the presenter mid-demo (High).**
`apps/backend/src/app.ts`: the global `express-rate-limit` was capped at 100 requests per
15-minute window, applied to every route including all tenant/admin API traffic. A single
person clicking through ~8 pages (dashboard alone fires 3 calls; most pages fire 2-5)
exhausts this in a few minutes — confirmed by reproducing it directly during this cycle's
own UI smoke test (started seeing `429 Too Many Requests` after the 6th page). This would
have hit mid-demo with no warning.
*Fix:* raised `max` to 2000 per 15-minute window. Still provides basic abuse protection,
comfortably covers an interactive demo session. Re-verified via a fresh UI smoke run:
zero 429s across 12+ page navigations.

**BUG-3 — Regulatory reports silently drop same-day transactions when a date is
explicitly selected (High, and *not* reproducible via curl — only found via the browser
because the frontend passes an explicit date and curl-without-params does not).**
`regulatory-reports.controller.ts`: `asOfDate`/`to` query params were parsed as
`new Date('2026-07-26')`, which is UTC **midnight start-of-day**, then used as an
inclusive upper bound (`entryDate: { lte: cutoff }`). Any transaction posted later that
same calendar day — which is exactly what happens the moment a user picks today's date
(the input's own default) and clicks "Tampilkan" — was silently excluded. Reproduced
live: the Neraca page's default-mount fetch (no explicit param) showed the correct
positive Kas; clicking "Tampilkan" with the same date already selected re-fetched with
`asOfDate=2026-07-26` explicit and the number visibly changed back to the wrong pre-fix
figure in front of the same screen. Affects all 5 regulatory endpoints + their PDF
variants (Neraca `asOfDate`; Arus Kas / Laporan Hasil Usaha / SHU Distribution / CALK `to`).
*Fix:* wrap the explicit-date branch in `date-fns`'s `endOfDay(...)` in all 9 call sites
across `regulatory-reports.controller.ts`. Re-verified via direct browser fetch: explicit
`asOfDate=2026-07-26` now returns the same figures as the implicit "now" default.
Full regulatory-reports/calk/shu-distribution/journal suites (32 tests) re-run clean, plus
the full 182-test backend suite.

**BUG-4 — Konfigurasi Akun page crashes (unhandled rejection) and shows a misleading
"not set up yet" empty state for any tenant without the `accounting` package module
(Medium — only affects the secondary `barokah` tenant; `demo` is unaffected).**
`AccountsConfigPage.tsx`'s `fetchAll()` used `Promise.all([...]).then().finally()` with no
`.catch()`. For a non-entitled tenant every one of those 5 calls 403s, so the whole
`Promise.all` rejects unhandled — surfaces as a real browser `pageerror` — and because
`.then()` never ran, `accounts` stays at its default `[]`, rendering the *exact same*
"Belum ada akun, klik Isi COA Standar" empty state a legitimately-entitled-but-not-yet-set-up
tenant would see, with the setup buttons fully enabled (they'd just 403 again on click).
*Fix:* added `.catch()` detecting `FEATURE_NOT_ENTITLED` and a dedicated render branch
showing "Fitur ini tidak termasuk dalam paket langganan koperasi Anda." Re-verified in
isolation: zero page errors, correct message.

**Investigated and ruled out (false positive):** the first UI smoke run also appeared to
show the platform-admin session bouncing back to `/login` with repeated 401s on every
page. Root-caused to a bug in *this test cycle's own harness*, not the product: the
diagnostic script's `waitForURL(/admin/)` regex matched the substring "admin" already
present in the hostname `admin.localhost` — including while still sitting on `/login` —
so the script raced ahead of the actual login completing. Re-tested with a corrected
path-only URL matcher: platform admin login, dashboard, tenants, and notifications all
work correctly, zero unexpected errors. Reported here for transparency since it was
initially treated as a real bug candidate before being disproven.

### 6.4 UI smoke test coverage

Playwright-driven Chromium, real login + navigation, screenshotted every page:
- `demo` tenant (12 pages): dashboard, members, savings, loans, loans/overdue, reports
  (financial), reports/regulatory, config/accounts, config/shu-distribution,
  config/modal-disetor, config/users, config/roles — all render correctly, zero console
  errors after BUG-2/BUG-3 fixes.
- `barokah` tenant (5 pages): dashboard, members, savings, loans, config/accounts — all
  correct after BUG-4 fix.
- Platform admin (4 pages): dashboard, tenants, packages, users — all correct.

## 7. Residual Risk / Known Limitations (accepted for tonight)

- **No automated frontend test suite exists** (`vitest` is configured but zero `*.test.*`
  files exist under `apps/frontend/src`). All frontend correctness this cycle came from
  scripted manual smoke testing, not a regression-proof suite — a future change could
  silently reintroduce a UI bug.
- **`AccountsConfigPage.tsx` was the only config page individually fixed** for the
  missing-`.catch()` pattern. `ShuDistributionConfigPage`, `ModalDisetorConfigPage`,
  `WhitelabelConfigPage`, `RolesPage`, `UsersPage` were smoke-tested for the `demo` tenant
  (entitled, so the failure mode can't trigger there) but not individually re-audited for
  the same class of bug on a non-entitled tenant. **Demo-script mitigation: avoid
  navigating to Konfigurasi Akun / Laporan Regulasi for the `barokah` tenant** beyond what
  was already verified above; keep the accounting/regulatory-reporting showcase on
  `demo`.
- **`eslint` is not runnable** in either app (missing dependency + config) — pre-existing,
  unrelated to tonight, recommend fixing separately.
- Only one non-accounting-entitled tenant (`barokah`, Syariah) and one fully-entitled
  tenant (`demo`, Konvensional) exist — a Syariah + accounting-entitled combination was
  never exercised.
- Frontend production bundle is a single ~1MB chunk (Vite warning) — cosmetic, not
  functional; code-splitting not attempted this cycle.
- Load, security, cross-browser, and mobile-responsive testing were not in scope.

## 8. Recommended Demo Script (safe path)

1. **Primary showcase — `demo` tenant** (`admin@demo.com` / `Admin123!`, subdomain
   `demo.localhost:5180`): dashboard → anggota → simpanan → pinjaman (show KOL badge
   colors — one loan seeded in each category, Lancar through Macet) → **Laporan Regulasi**
   (Neraca/Arus Kas/Hasil Usaha/Pembagian SHU/CALK — all verified balanced and populated
   this cycle) → PDF export of any of the four.
2. **Multi-tenant / package differentiation — `barokah` tenant** (`admin@barokah.com` /
   `Admin123!`, subdomain `barokah.localhost:5180`): dashboard/anggota/simpanan/pinjaman
   only, to show the Syariah cooperative type and a lower package tier. Skip Konfigurasi
   Akun / Laporan Regulasi per §7.
3. **Platform owner view — `admin.localhost:5180`** (`superadmin@siskop.com` /
   `SuperAdmin123!`): tenant list, packages, platform users, notifications.

## 9. Sign-off (cycle 1)

**Recommendation: GO**, with the demo-script mitigation in §8/§7 followed. All defects
found this cycle that were in-scope for the planned demo path are fixed and reverified;
the one residual risk has a documented, low-cost workaround rather than a rushed fix.

Files changed this cycle (all reverified against the full automated suite + a fresh UI
smoke pass afterward):
- `apps/backend/src/app.ts` — rate limit BUG-2
- `apps/backend/src/modules/reports/regulatory-reports.controller.ts` — date cutoff BUG-3
- `apps/frontend/src/pages/config/AccountsConfigPage.tsx` — entitlement handling BUG-4

Plus one data change (not a code change): one additional Rp 10,000,000 savings deposit on
the `demo` tenant, made via the real API, to correct the negative-cash optic left after
fixing BUG-1 (§6.3).

## 10. Follow-up hardening pass (same day, broader sweep)

Requested explicitly: "fix all bugs and ensure the system working smooth" — a second,
wider pass beyond the demo-critical path of cycle 1, covering the whole frontend and a
recheck of the backend controller layer.

### 10.1 Systemic audit: unhandled promise rejections across the frontend

BUG-4 (§6.3, cycle 1) turned out to be one instance of a repeated pattern: `.then()`
chains and `await` calls with no `.catch()`/`try` anywhere in the component. Audited
every `.tsx` file under `apps/frontend/src` for this (`then` count vs `catch` count,
and `await api.` calls outside any `try` block). Found and fixed **~20 files** with the
gap — either a missing `.catch()` on a background list-fetch (silently leaves a page
looking empty/broken with zero feedback), or an un-awaited `async` handler with no error
path (unhandled rejection on click). Fixed with a toast-on-failure in each case,
consistent with each file's existing error-handling style. Full file list is in the diff;
notable ones: `ShuDistributionConfigPage.tsx`, `ModalDisetorConfigPage.tsx`,
`WhitelabelConfigPage.tsx`, `RolesPage.tsx`, `UsersPage.tsx`, `LoanConfigPage.tsx`,
`SavingConfigPage.tsx`, `MemberFormPage.tsx`, `NewLoanPage.tsx`, `NewSavingPage.tsx`,
`AdminUsersPage.tsx`, `NotificationBell.tsx`, `ReportsPage.tsx` (PDF download had no
error handling at all).

**Entitlement-aware version of the same fix** applied to every regulatory-report tab
(`NeracaTab`, `ArusKasTab`, `LabaRugiTab`, `ShuDistribusiTab`, `CalkTab`) and
`ShuDistributionConfigPage.tsx` — all five are gated by the same `accounting` package
entitlement as BUG-4's `AccountsConfigPage`, and all five had the identical missing-catch
bug, meaning **all of Laporan Regulasi silently broke for a non-entitled tenant**, not
just Konfigurasi Akun. Added a shared `isFeatureNotEntitled()` helper
(`apps/frontend/src/lib/api.ts`) and a shared `<NotEntitledNotice />` component
(`apps/frontend/src/components/shared/NotEntitledNotice.tsx`) so all six places render
the same clear message instead of a misleading empty/loading state. Reverified on
`barokah` (non-entitled): zero page errors, correct message, for both Konfigurasi Akun
and every tab of Laporan Regulasi.

### 10.2 Backend controller audit

Checked every `*.controller.ts` for the try/catch/`next(err)` convention CLAUDE.md
requires. All 12 files, 88 exported handlers total, already 1:1:1 consistent — no
backend defect of this class existed. No changes needed.

### 10.3 BUG-5 — `Hari Terlambat` (days overdue) always blank on `/loans/overdue` (High)

Found via visual review of a screenshot, not automated tooling. `apps/backend/src/lib/kol.ts`'s
`recalculateKOL()` computes `maxDaysOverdue` correctly (used to derive `kolCategory`) but
only ever persisted `kolCategory` — the number itself was discarded every time. There was
**no `daysOverdue` column on `Loan` at all** despite `Docs/kol-categories.md` documenting
one ("KOL value stored on `Loan.kolCategory` (enum) and `Loan.daysOverdue` (Int)"). The
frontend's `OverdueLoan` interface expected the field; React silently renders `undefined`
as nothing, so the column showed blank instead of erroring.

*Fix:* added `daysOverdue Int @default(0)` to the `Loan` model
(`prisma/migrations/20260726143131_add_loan_days_overdue/`), persisted it alongside
`kolCategory` in `recalculateKOL()`, backfilled all existing active loans by re-running
`recalculateAllKOL()` (confirmed every loan's `kolCategory` came back byte-identical to
before — the recalculation is idempotent, only `daysOverdue` was newly populated: 213/
151/92/62 days for the four seeded overdue loans, matching their existing MACET/
DIRAGUKAN/KURANG_LANCAR/DALAM_PERHATIAN categories exactly).

### 10.4 BUG-6 — `Bayar Terakhir` (last payment date) always shows "–" on `/loans/overdue` (Medium)

Same page, adjacent column, different root cause. `loansService.getOverdue()` returns a
`payments` array (`take: 1`, most recent), but the frontend reads a flat `lastPaymentAt`
field that never existed in the response — always falls through to the "–" placeholder,
even when a payment record exists. *Fix:* `getOverdue()` now maps the Prisma result to a
flat `lastPaymentAt: payments[0]?.paidAt ?? null`. Reverified: all 4 seeded overdue loans
now show their actual last-payment date (25 Jul 2026) instead of "–".

### 10.5 Bonus: wired up a dead search state + a defined-but-unused row-tint map

Found as a side effect of cleaning up ESLint's unused-variable warnings, not from the bug
hunt directly, but both are real gaps a user would notice:
- **`LoansDashboardPage.tsx`**: `search`/`setSearch` state existed and was already
  threaded through to the API call, but no `<Input>` was ever rendered for it — the
  Pinjaman list had no way to actually search. Added the missing `search` prop to the
  existing `<DataTable>` (which already supports it — `MembersPage.tsx` uses the same
  prop), following the exact pattern already used elsewhere in the app.
- **`OverduePage.tsx`**: a `ROW_TINT` map (MACET → red tint, DIRAGUKAN → orange tint) was
  defined but never applied to any row — dead code. Added a generic `rowClassName` prop
  to the shared `DataTable` component and wired `ROW_TINT` into it. Now MACET/DIRAGUKAN
  rows are visually tinted on `/loans/overdue`, matching the KOL badge color convention
  from `Docs/kol-categories.md`.

### 10.6 ESLint set up for both apps (was completely non-functional before)

Neither app had `eslint` as a dependency or a config file — `pnpm lint` / `npm run lint`
has never actually run in this repo (a pre-existing gap, noted but not fixed in cycle 1).
Added `eslint` + `typescript-eslint` to both apps, `eslint-plugin-react-hooks` +
`eslint-plugin-react-refresh` to the frontend, and a flat `eslint.config.js` for each.

Two deliberate exceptions from defaults, both documented inline in the config with a
comment explaining why:
- **Backend**: `@typescript-eslint/no-namespace` off — `declare global { namespace
  Express { ... } }` in `auth.middleware.ts`/`tenant.middleware.ts` is the required TS
  idiom for augmenting Express's `Request` type; there's no ES2015-module equivalent.
- **Frontend**: only `react-hooks/rules-of-hooks` (error) and `react-hooks/exhaustive-deps`
  (warn) enabled from `eslint-plugin-react-hooks`, not its full `recommended` config.
  Version 7.x bundles React Compiler readiness rules (`set-state-in-effect`,
  `incompatible-library`) into `recommended`; those flagged the standard fetch-on-mount
  pattern (`useEffect(() => { load() }, [])` calling `setState`) used throughout this
  app — correct, working code — as 25 hard errors. This app doesn't use the React
  Compiler and isn't adopting it as part of this QA pass, so those rules are off.

Result: backend went from a broken `npx eslint` (wrong major version, no config) to 0
errors/0 warnings. Frontend went from broken to 77 problems (25 real errors from the
compiler-rules mismatch above, the rest unused imports/vars and legitimate
exhaustive-deps notices) down to **0 errors, 2 warnings** — the 2 remaining warnings are
in a duplicated, vendored shadcn `use-toast.ts` boilerplate file (two near-identical
copies already existed pre this session, under `components/hooks/` and `hooks/`; left
alone as out of scope — a dedup is a refactor, not a bug fix) and are functionally inert.
Every `react-hooks/exhaustive-deps` warning for an intentional mount-only fetch got an
inline `eslint-disable-next-line` with a one-line reason, matching a pattern the
regulatory-report tabs already used before this session.

### 10.7 Full regression after this pass

- Backend: 182/182 tests passing (16/16 suites), `tsc --noEmit` clean, `eslint` clean.
- Frontend: `tsc --noEmit` clean, `vite build` succeeds, `eslint` clean (2 inert warnings).
- UI smoke test re-run across all three logins (`demo`, `barokah`, platform admin) —
  zero unexpected console/page errors, screenshots confirm Konfigurasi Akun, all 5
  Laporan Regulasi tabs, the new Pinjaman search box, and the Anggota Menunggak row
  tinting/day counts/last-payment dates all render correctly.
- New DB snapshot taken post-migration: `siskop_dev_final_good_state.dump` (inside the
  `siskop_db` container at `/tmp/backup/`) — supersedes the cycle-1 snapshot as the
  restore point, since the schema itself changed (new `daysOverdue` column).

## 11. Final sign-off

**GO.** Six real bugs found and fixed across both cycles (seed-data journal gap,
rate limiter, report date-cutoff, entitlement-error handling x6 places, missing
days-overdue persistence, missing last-payment-date mapping), plus two dead-UI gaps
wired up (loans search, KOL row tinting), plus both apps' lint tooling repaired from
non-functional to clean. Full diff: 3 files (cycle 1) + ~38 files (cycle 2, mostly small
try/catch additions) + 1 migration. All reverified against the automated suite and a
scripted UI walkthrough after every change, not just at the end.
