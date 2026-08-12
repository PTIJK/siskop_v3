# 06 — Product Requirements Document (PRD): SISKOP Mobile Version

Status: living document, first draft **2026-08-12**. Owner: Product Manager per `CLAUDE.md`
"Module ownership"; Engineer/QA/Ops co-sign per the team model described there.

**This document is additive to `docs/01-PRD-SISKOP.md`, not a replacement.** Users/roles, the
tenant/unit model, the module inventory, and the subscription/entitlement model are all defined
there and unchanged by this initiative — this document states only what is new or different for the
mobile effort. Where the two would otherwise conflict, treat `01-PRD-SISKOP.md` as authoritative for
product scope and this document as authoritative for the mobile-specific plan layered on top of it.

## 1. Problem statement

SISKOP today is a desktop-oriented responsive web app (`apps/frontend`). Two real usage patterns are
underserved by that:

- **Field staff** (petugas lapangan) who visit members at their homes/businesses to collect savings
  deposits, loan repayments, and enroll new members do not carry a desktop with them — today they
  either write on paper and re-enter data later, or don't have their tenant's live data (member
  balances, loan status) with them at all.
- **Pengurus/management** who want to check dashboard figures, member status, or loan portfolio
  health outside office hours currently have to open the desktop-oriented layout on a phone browser,
  where — per the UI audit in §8 — list/table-heavy screens are frequently unusable at phone widths.

This document scopes a **mobile-optimized version of SISKOP** to serve both, starting with a
read-only Fase 1 (§4, §6).

## 2. Relationship to the existing PRD

`docs/01-PRD-SISKOP.md` §2 lists as a non-goal: *"Mobile native apps (the frontend is a responsive
web app only)."* This document does not contradict that line — Fase 1 here (§4) is a second,
phone-optimized **responsive web app** (a PWA), not a native binary, so it is still "a responsive web
app" in the sense that line intends. Fase 2 (native) is explicitly conditional and not committed
(§4). `01-PRD-SISKOP.md` §2 has been updated with a one-line cross-reference to this document so a
reader of the non-goals list isn't misled into thinking no mobile work exists.

## 3. Goals

| Goal | Target | Note |
|---|---|---|
| Field staff can check a member's savings/loan status on-site before deciding what to collect | Data visible within a few taps, no horizontal scrolling/illegible tables | Read-only in Fase 1 — see §6, §11 |
| Management can check dashboard/report figures from a phone | Same data as desktop Dashboard, legible at 375px width | |
| No regression to existing desktop product or backend | Zero backend/schema changes required for Fase 1 | See §9, §10 |
| Installable, app-like feel without native app-store distribution | PWA manifest + "Add to Home Screen" | Contingent on Fase 1 scope — see §4 |

No adoption/usage numeric targets are set here (unlike `01-PRD-SISKOP.md` §2's tenant-adoption/NPS
goals) — this is a new, unreleased surface with no baseline yet. Revisit once Fase 1 ships and has
real usage to measure against.

## 4. Staged approach: Fase 1 (PWA) vs. Fase 2 (native, conditional)

Decision made 2026-08-12: SISKOP as a whole has not yet been approved ("belum di-ACC") by the
koperasi's direktur, so this initiative deliberately avoids over-investing in native app-store
packaging before that approval exists.

- **Fase 1 (this document's scope)**: mobile web / PWA. New frontend app in the monorepo (see §10),
  reusing the existing Express backend, JWT-bearer + httpOnly-cookie refresh auth, subdomain-based
  tenant resolution, and `@siskop/types` — **no backend changes required**.
- **Fase 2 (conditional — not committed, not scheduled)**: React Native or a Capacitor-wrapped
  shell, only if the whole system is approved and installable-app distribution becomes an explicit
  requirement. This is flagged here because it is **not** a pure frontend decision if it happens:
  - The refresh token is an httpOnly cookie (`docs/04-System-Architecture-SISKOP.md` §6) — a
    browser-only mechanism. A native HTTP client doesn't automatically carry it; Fase 2 would need a
    different refresh-token transport (e.g. secure native storage), which is a backend-contract
    change, not just a new UI.
  - Tenant resolution is by `Host` subdomain (`CLAUDE.md` rule 1; `docs/04-System-Architecture-SISKOP.md`
    §5) — a native app calling one fixed API base URL has no subdomain to resolve from. Fase 2 would
    need a different, still-secure way to identify the tenant at login (not a request-body field,
    per the standing security rule) — an open product/security question, not a decided design.
  - Neither of these blocks Fase 1. They are listed so Fase 2, if it happens, isn't treated as "just
    port the mobile web UI to React Native."

## 5. Users and personas

Both personas are in scope for Fase 1 from the start (not sequenced one after the other):

| Persona | Primary need | Fase 1 relevance |
|---|---|---|
| **Petugas lapangan** (field staff) | Look up a member's savings/loan status while on-site, before deciding what to collect | Members, Savings, Loans read-only views |
| **Pengurus/management** | Check dashboard figures, portfolio health, reports away from the office | Dashboard, Reports read-only views |

Same underlying `User`/`Role`/`Permissions` model as desktop (`docs/01-PRD-SISKOP.md` §3) — mobile
does not introduce a new role or a member-facing login. `Member`s still never log in
(`docs/01-PRD-SISKOP.md` §9.5) — a field staff member views member data through their own staff
session, they don't hand the phone to the member.

## 6. Scope — Fase 1

**Feature scope: read-only.** No deposit/withdrawal, no loan repayment recording, no member
creation/edit from the phone in Fase 1 — all writes still go through the desktop app. This mirrors
the original mentor-assignment framing (a prior, uncommitted attempt at this — see repository memory
— was scoped the same way) and keeps the UI-risk surface (§8) to list/detail views only, not the
create/edit dialogs and forms that desktop already handles reasonably well.

**Full feature parity principle (confirmed 2026-08-12).** Within every in-scope module, *every*
desktop feature that is not a write action must have a mobile equivalent — no viewing/informational
feature may be silently dropped for being secondary or hard to fit, including things easy to
overlook because they aren't the "main" data on a page: rule-based insight cards, charts, progress
indicators, alert banners, status-filter tabs, and secondary filters. This principle was added after
a first Fase 1 pass (Dashboard) shipped without the desktop's "Rekomendasi AI" card and without its
two charts — an unintentional omission, not a scoped-out decision — caught by the user reviewing the
build, not by this document. See §7 for the specific requirements this added and §8.4 for the
process gap that let it happen. **This principle governs completeness *within* the modules listed
"In" below — it does not reopen the Config/Platform Admin/Users exclusions**, which were separate,
already-confirmed module-level decisions (§12) made for reasons (write-heavy nature, cross-tenant
scope) that full-parity-within-scope doesn't override.

**Module scope:**

| Module | Fase 1 mobile scope | Rationale |
|---|---|---|
| Dashboard | In — full parity with `DashboardPage.tsx`: summary stat cards, both charts, and the Rekomendasi AI card (§7) | Core "check status on the go" use case for both personas |
| Members | In — list + detail (view only, including KTP photo view) | Core field-staff lookup use case |
| Savings | In — list + detail, balance + transaction history, product-type filter (view only) | Core field-staff lookup use case |
| Loans | In — list + detail, KOL status, overdue view, status tabs, overdue banner, progress indicator (view only) | Core field-staff lookup use case |
| Reports | In — full financial/RAT summary views, all sub-sections (view only); regulatory reports (Neraca/Arus Kas/etc.) deferred — see below | Core management use case |
| Profile | In — **view only** (name, email, role); password change and profile editing remain write actions, excluded (§11) | Was missing from the original Fase 1 draft (§12) — added under the parity principle |
| Config | **Recommended out for Fase 1** (open item — see below) | Write-heavy by nature (COA, roles, mappings); read-only view of config screens has little standalone value, and it carries the heaviest UI risk in the whole app (§8: `RolesTab`'s permission matrix, `AccountsTab`'s indented COA) |
| Platform Admin | **Out for Fase 1** | `super_admin`-only, cross-tenant SaaS-operator console, architecturally confined to `/platform/*` (`docs/01-PRD-SISKOP.md` §4a) — not used by koperasi field/management staff at all |
| Users (Pengguna) | Out for Fase 1 | Staff-management, not a field/monitoring need |

Config's exclusion is **this document's recommendation, not a confirmed decision** — flagged
separately in §12 since it wasn't explicitly put to the user the way Platform Admin's exclusion was.

Within Reports, the 5 Permenkop UKM No. 2/2024 regulatory statements (Neraca, Arus Kas, Laporan Hasil
Usaha, Pembagian SHU, CALK) are **deferred past Fase 1**: per the UI audit (§8), several of their
tables (`ShuDistribusiTab`, `CalkTab`'s `MutasiTable`) are the widest/densest financial-statement
tables in the app and would need the most redesign work for the least field-staff/day-to-day value —
the financial + RAT summary reports (`ReportsPage.tsx`) cover the "check figures on the go" need with
much lower UI risk.

## 7. Functional requirements (Fase 1, read-only)

| ID | Requirement | Source (desktop equivalent) |
|---|---|---|
| FR-MOB-DASH-01 | Show the same dashboard summary figures as desktop (member count, savings totals, loan portfolio, overdue count), legible without horizontal scroll at 375px width | `FR-DASH-01`, `DashboardPage.tsx` |
| FR-MOB-DASH-02 | Dashboard charts (loan disbursement per bulan, payment/cicilan per bulan) render legibly and support tap-to-reveal tooltips on touch, not hover-only — **committed, not optional/deferrable**; chart-library choice (`docs/07-System-Architecture-SISKOP-Mobile-Version.md` §10) is an implementation detail, not a scope question | `DashboardPage.tsx` recharts usage |
| FR-MOB-DASH-03 | "Rekomendasi AI" card: same rule-based insights as desktop, computed client-side from data the dashboard already fetches (`lib/aiSuggestions.ts` — pure function, no LLM/extra API call, cheap to port) | `DashboardPage.tsx`'s `buildAiSuggestions()` card — **added 2026-08-12, was missing from the first Fase 1 draft** (§12) |
| FR-MOB-MEM-01 | List members, searchable, with the same fields as `MembersPage.tsx` presented in a mobile-appropriate layout (not a raw 8-column table — see §8) | `FR-MEM-04` |
| FR-MOB-MEM-02 | View a member's detail (identity, KTP photo, enrolled units) and their savings/loan summary | `FR-MEM-01`, `MemberDetailPage.tsx` |
| FR-MOB-SAV-01 | List a member's (or all) savings accounts with balance, searchable **and filterable by product type** (Pokok/Wajib/Sukarela dropdown — same as desktop, not optional) | `FR-SAV-*`, `SavingsPage.tsx` |
| FR-MOB-SAV-02 | View a savings account's transaction history (deposit/withdrawal ledger) without the "Catatan" free-text column causing overflow | `SavingDetailPage.tsx` — see §8 risk |
| FR-MOB-LOAN-01 | List loans with status, KOL classification, and remaining balance, without the desktop's 9-column table; **including** the overdue-count alert banner (links to FR-MOB-LOAN-03's view), the Semua/Aktif/Lunas status tabs, and the loan-type filter — all three are on desktop's `LoansDashboardPage.tsx` and are in scope, not just the raw table data | `LoansDashboardPage.tsx` — see §8 risk |
| FR-MOB-LOAN-02 | View a loan's detail: amortization terms, KOL status, payment history, **and the paid/remaining progress indicator** (% lunas + Dibayar/Sisa figures) — a distinct visual element on desktop's `LoanDetailPage.tsx`, not just the raw numbers | `LoanDetailPage.tsx` |
| FR-MOB-LOAN-03 | "Anggota Menunggak" (overdue) view, same data as `OverduePage.tsx`, including its alert banner and KOL-severity row highlighting (already noted as functionally important in §8.2) | `FR-LOAN-07` |
| FR-MOB-RPT-01 | View the financial and RAT summary reports (`ReportsPage.tsx`) for a date range, with **full parity on sub-sections**, not just headline figures: all 3 period-selection modes (Range Tanggal/Bulanan/Tahunan); Financial tab's 3 stat cards + 3 detail tables (Rincian Simpanan per Jenis, Rincian Transaksi Simpanan, Rincian Pinjaman); RAT tab's 6 stat cards + 2 detail tables (Simpanan per Jenis, Distribusi Kualitas Pinjaman/KOL) | `FR-RPT-01`, `FR-RPT-02` |
| FR-MOB-RPT-02 | PDF export of the above, using a mobile-appropriate download/share mechanism (not the desktop's Blob+`<a download>` pattern — see §8) | `FR-RPT-03` — mechanism must change, not just style |
| FR-MOB-AUTH-01 | Login via the same subdomain-based flow as desktop (`demo.localhost`/production subdomain), single-column layout already close to mobile-ready (`LoginPage.tsx` — see §8) | `FR-AUTH-03` |
| FR-MOB-PROFILE-01 | View own profile: name, email, role. **Editing (name/email) and password change are write actions, explicitly out of scope** (§11) — this is display-only, added under the parity principle (§6, §12) since desktop's `ProfilePage.tsx` was otherwise entirely unaccounted for in the first Fase 1 draft | `FR-AUTH-12` (edit portion excluded), `ProfilePage.tsx` |

All of the above are **view-only**: no route in Fase 1 should expose a create/edit/delete action,
even where the underlying API would technically allow it for the logged-in role.

## 8. UI/UX requirements & known risk inventory

A full page-by-page audit of `apps/frontend/src/pages/` (all ~30 pages) and shared components was
done against the current `main` branch (verified clean working tree, commit `bba8705`, 2026-08-12) to
avoid the failure mode of a previous, unrelated project where a web-to-app conversion silently broke
layout and formatting. Findings below are the concrete requirements this mobile version must satisfy;
file:line references are point-in-time (re-verify if the underlying file has changed since).

### 8.1 Systemic patterns — fix once, applies everywhere

These are the highest-leverage fixes: each one, done in a shared component, resolves risk across many
pages at once rather than needing a per-page patch.

| Pattern | Requirement | Affects |
|---|---|---|
| `DataTable` (`components/shared/DataTable.tsx`) has no card-list fallback for narrow viewports | Below a defined breakpoint, list views must render as a card list, not a raw `<table>` | 14 desktop pages use `DataTable`; Fase 1 touches Members/Savings/Loans/Overdue directly |
| No table anywhere is wrapped in `overflow-x-auto` | Every table (including raw `<Table>` usage in `SavingDetailPage.tsx`/`LoanDetailPage.tsx` ledgers and all 5 regulatory report tabs) needs either a card-list redesign or an explicit horizontal-scroll container as a fallback | All list/ledger/report views |
| `grid grid-cols-2`/`grid-cols-3` used without a responsive (`sm:`) fallback | Any such grid touched by Fase 1 pages must add a `grid-cols-1 sm:grid-cols-N` fallback | `MemberDetailPage.tsx:199`, `LoanDetailPage.tsx:121` (both in Fase 1 scope) |
| `TabsList` wraps onto multiple rows instead of scrolling horizontally | Where Fase 1 uses tabs (e.g. `MemberDetailPage`'s Info/Simpanan/Pinjaman tabs — only 3, low risk), keep as-is; do not adopt the same pattern for anything wider | `ConfigPage.tsx` (out of scope, §6), `RegulatoryReportsPage.tsx` (deferred, §6) |
| PDF export via `Blob` + programmatic `<a download>` click (`lib/pdf.ts`) | Needs a mobile-verified download mechanism — this pattern is known to be unreliable on iOS Safari and in-PWA contexts; verify on real devices before shipping FR-MOB-RPT-02, consider opening the PDF in a new tab or `navigator.share` as an alternative | `ReportsPage.tsx` (2 call sites) — directly in Fase 1 scope |

### 8.2 Per-module risk detail (Fase 1 modules only)

| Module/page | Risk | Reference |
|---|---|---|
| Members list | 8-column table (3 monospace ID-style columns) — widest table touching Fase 1 scope | `MembersPage.tsx:30-74` |
| Member detail | Fixed 3-column `dl` for loan summary (Pokok/Total/Sisa), no responsive fallback; KTP thumbnail fixed at `h-32 w-48` px (not relative) | `MemberDetailPage.tsx:199`, `:108` |
| Savings detail | Raw `<Table>` (not `DataTable`) for transaction ledger, 5 columns including unbounded free-text "Catatan" | `SavingDetailPage.tsx:123-166` |
| Loans list | 9-column table (4 money + 2 badge + 2 text columns) — single highest-risk table touching Fase 1 scope | `LoansDashboardPage.tsx:56-77` |
| Loan detail | Same raw-`<Table>` ledger risk as Savings detail; fixed `grid-cols-3` for Pokok/Total/Angsuran | `LoanDetailPage.tsx:161-190`, `:121` |
| Overdue | 7-column table with badge/colored-text columns; row-level color-coding (`ROW_TINT`) is functionally important (severity signal) and must be preserved in any card-list redesign, not dropped as "just styling" | `OverduePage.tsx:25-28`, `:44-84` |
| Reports (financial/RAT) | Filter row uses several fixed-`w-*` inputs in a `flex flex-wrap` row — wraps acceptably but not touch-optimized; 3-4 column simple tables are moderate (not severe) risk | `ReportsPage.tsx:110-184` |
| Login | Already close to mobile-ready — single column, `max-w-sm`, no desktop-only split layout | `LoginPage.tsx` |
| Dashboard | Stat-card grid already has a responsive fallback (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`); charts use `recharts` `ResponsiveContainer` with hover-only tooltips — touch interaction needs device verification | `DashboardPage.tsx:93`, `:172-205` |

### 8.3 Formatting

`formatRupiahSingkat()` (short-form currency, e.g. "Rp 1.2jt") exists in `lib/format.ts` but today is
used **only** in Dashboard chart axes — everywhere else, including every table/card this document
puts in scope, uses the long form (`formatRupiah()`, e.g. "Rp 1.200.000"). Any new mobile card/list
component showing a money value in constrained width should default to the short form, per the
lesson already captured from a prior session's `StatCard` overflow incident (repository memory:
"Study before UI build").

### 8.4 Not yet checked — verify during implementation, not blocking this PRD

- Touch interaction on `recharts` tooltips (code-level inspection can't confirm this; needs a real
  device test).
- iOS Safari vs. Android Chrome differences in the PDF Blob-download pattern (§8.1) — needs a real
  device/browser test before FR-MOB-RPT-02 is considered done.
- `components/shared/ErrorBoundary.tsx`, `LoadingSpinner.tsx`, `EntitlementNotice.tsx`,
  `NotEntitledNotice.tsx`, `KOLBadge.tsx` were not individually audited (small, low-layout-footprint
  components) — low risk, but worth a quick pass once mobile screens are actually being built.

### 8.5 Process gap that caused the Dashboard omission (added 2026-08-12)

The first Fase 1 build shipped Dashboard without the Rekomendasi AI card or either chart, even though
this document's author had read `DashboardPage.tsx` directly earlier in the same audit and knew both
existed. The cause: FR-MOB-DASH-01/02 as originally written summarized desktop's page into a short
requirement sentence, and implementation was built from that summary rather than by checking the
summary against the source file feature-by-feature before building. The fix applied here isn't just
adding the missing rows (§7) — it's the standing rule in §6's parity principle: **before any Fase 1
screen is considered complete, re-open its desktop source file and check every distinct
section/widget/card against the built mobile screen, not just against the FR wording**, since FR
wording is a summary and summaries lose detail. This is the same category of mistake the UI-risk
audit (§8.1–8.3) already exists to prevent for *layout* — this section extends the same discipline to
*feature completeness*.

## 9. Non-functional requirements

| ID | Requirement | Note |
|---|---|---|
| NFR-MOB-PERF-01 | Load time targets follow the existing NFR-PERF-01/02 (`docs/02-System-Requirements-SISKOP.md`) — no separate mobile target set, until real usage data exists | Same standard as desktop, not relaxed |
| NFR-MOB-OFFLINE-01 | **No offline support required for Fase 1.** App assumes an active connection; no service-worker caching/sync strategy needed | Explicit scope cut, confirmed 2026-08-12 — not an oversight. Revisit if field usage in low-signal areas becomes a blocking complaint |
| NFR-MOB-PWA-01 | Installable as a PWA: web app manifest (name, icons, `theme-color`), "Add to Home Screen" support | New work — `apps/frontend/index.html` today has no manifest link, no PWA meta tags at all (verified §8) |
| NFR-MOB-VIEWPORT-01 | `viewport-fit=cover` + safe-area-inset handling for notched devices | New work — current viewport meta tag is the Vite/React default only |
| NFR-MOB-DEVICE-01 | Primary target: Android (majority of the Indonesian mobile market), verified manually in current-channel Chrome, mirroring the existing desktop NFR's "verified manually in current-channel Chrome only" (`docs/02-System-Requirements-SISKOP.md` §3) | **Assumption — not confirmed with a specific device/browser matrix.** See §12 |
| NFR-MOB-SEC-01 | No change to tenant isolation, RBAC, or entitlement rules (`CLAUDE.md` rules 1/3) | Read-only scope makes this lower-risk than desktop, but the same `tenantId`-from-JWT rule applies to every new mobile-facing route |
| NFR-MOB-TEST-01 | Verified on at least one real device before considered done for any given screen — not just browser dev-tools width resize | Directly motivated by the prior-project incident that prompted this audit in the first place |

## 10. Technical approach summary

- **New frontend app** in the existing pnpm/Turborepo monorepo (planned path: `apps/mobile`, matching
  a prior, uncommitted attempt at this — see repository memory). React + Vite + Tailwind, deliberately
  light (no Radix-heavy component kit duplication, no `recharts` unless Dashboard charts need it,
  reusing `@siskop/types` directly).
- **No backend changes for auth/routing/data-model** — same Express API, same `ApiResponse<T>`
  envelope, same JWT-bearer + httpOnly-refresh-cookie auth flow, same subdomain-based tenant login
  (`demo.<host>` pattern) — all verified compatible with a browser-based PWA client in this session's
  research. **This does not mean zero backend edits ever**: building Savings (2026-08-12) surfaced a
  genuine pre-existing bug shared with desktop — `GET /api/savings?type=` was accepted by desktop's
  UI (a working-looking dropdown) but silently ignored by the backend (`listSavingsQuerySchema` never
  declared the field; `listSavings()` never read it). Fixed with a proper TDD cycle (failing test →
  `schema.ts`/`service.ts` fix → 217/217 backend tests green) since the mobile card-list is not a
  place to *replicate* a decorative dead filter — desktop inherits the fix for free. Any future screen
  that surfaces a similar desktop bug should be fixed the same way (small, tested, backend change),
  not silently ported broken.
- **Read-only enforcement**: at the UI layer (no write actions rendered), same defense-in-depth
  pattern as the prior mobile MVP attempt — backend RBAC still applies as a second layer, not
  relied upon alone.
- Component work is scoped by §8: a card-list variant for list views, `overflow-x-auto` fallback for
  any remaining tabular content (ledgers), and mobile-appropriate PDF handling.

## 11. Out of scope / explicitly deferred

- Any create/update/delete action from the mobile UI (§6) — Fase 2-or-later. Explicitly includes
  `ProfilePage.tsx`'s two forms (edit name/email, change password) — FR-MOB-PROFILE-01 (§7) is
  view-only.
- Native app / app-store distribution (§4) — conditional on director approval, not scheduled.
- Offline support (§9, NFR-MOB-OFFLINE-01).
- Config, Platform Admin, Users (Pengguna) modules (§6).
- The 5 Permenkop UKM regulatory reports (Neraca/Arus Kas/Laporan Hasil Usaha/Pembagian SHU/CALK)
  (§6) — deferred past Fase 1 alongside Config, for the same reasons.
- Push notifications (the desktop `Notification`/`NotificationRead` schema exists but nothing
  consumes it yet, per `docs/03-ERD-SISKOP.md` §4 — mobile doesn't change that).
- KTP photo **upload**/capture from mobile — Fase 1 is read-only, so only *viewing* an already-uploaded
  KTP photo is in scope (FR-MOB-MEM-02); the upload flow and its camera-capture UX (`capture`
  attribute, etc.) is a Fase-2-or-later, write-scope concern.

## 12. Open questions

**Resolved 2026-08-12** (confirmed by the user before scaffolding started):

1. ~~Config module exclusion~~ — **confirmed excluded from Fase 1**, alongside Platform Admin and
   Users (Pengguna). Read-only Fase 1 scope is Dashboard/Members/Savings/Loans/Reports
   (financial+RAT only, regulatory reports still deferred per §6).
2. ~~Serving/routing strategy~~ (see `docs/07-System-Architecture-SISKOP-Mobile-Version.md` §7) —
   **path-based (`/m/*`) confirmed** as the production approach.
3. ~~Automated testing for `apps/mobile`~~ — **confirmed: no automated test suite for Fase 1**,
   matching `apps/frontend`'s existing precedent. Real-device verification (NFR-MOB-TEST-01) remains
   mandatory per screen; this is a process decision, not a lowering of that bar.
4. ~~PWA icon/branding assets~~ — **confirmed: ship with a placeholder icon set** derived from the
   existing visual language (the `Building2`-in-primary-square mark used in `Sidebar.tsx`), replace
   with real design assets later without blocking Fase 1 start.
5. **New constraint confirmed 2026-08-12, not previously captured**: the user's condition for
   proceeding to implementation is that **format and function must not break — the mobile version
   should stay visually and functionally close to the existing desktop web app**, not read as a
   different product. Concretely: reuse the exact same Tailwind CSS design tokens/colors (not a new
   palette), the same Indonesian terminology/labels, and show the same underlying data as each
   desktop equivalent (only the layout mechanics change — table→card, not the information shown).
   This directly shapes `docs/07-System-Architecture-SISKOP-Mobile-Version.md` §4/§8's component
   decisions and is the primary acceptance bar for every screen built.
6. **Navigation pattern decided**: bottom tab bar (not a hamburger+drawer port of `Sidebar.tsx`) —
   the user's explicit choice, even though it's a bigger visual departure from desktop than the
   alternative; reconcile this with item 5's "stay close to desktop" framing by keeping color/type/
   terminology identical while accepting the nav *shape* differs, since bottom-tab is what was chosen.
7. **Full feature parity, confirmed 2026-08-12** (§6, §8.5): triggered by the user catching that the
   first Dashboard build was missing the Rekomendasi AI card and both charts. The user's explicit
   position: *every* desktop feature that isn't a write action must transition to mobile — none may
   be dropped for being secondary. Added FR-MOB-DASH-03 (AI card) and FR-MOB-PROFILE-01 (profile
   view), and expanded FR-MOB-LOAN-01/02 and FR-MOB-RPT-01 to name features their original terse
   wording didn't spell out (overdue banner, status tabs, progress indicator, full report
   sub-sections). This principle applies *within* already-in-scope modules — it does not reopen the
   Config/Platform Admin/Users exclusions (item 1), which were separate module-level scope decisions.

**Still open:**

7. **Target device/browser matrix (NFR-MOB-DEVICE-01)** is an assumption (Android-majority, Chrome),
   not confirmed against an actual requirement — revisit if the mentor/stakeholder specifies otherwise.
8. **No mentor-provided grading rubric or explicit deadline was available when this document was
   written** — if one exists, its requirements should be reconciled into this document's scope (§6)
   and goals (§3) explicitly, not assumed to already be covered.
9. **Fase 2 auth/tenant-resolution redesign** (§4) is flagged, not designed — if Fase 2 is ever
   greenlit, it needs its own technical design pass before implementation starts.
10. **PDF export mechanism for mobile (§8.1, FR-MOB-RPT-02)** needs a concrete decision (new-tab open
    vs. `navigator.share` vs. something else) once device testing confirms what actually breaks.

## 13. Related documents

- `docs/01-PRD-SISKOP.md` — parent PRD: product scope, users/roles, module inventory, subscription
  model (all unchanged by this document)
- `docs/02-System-Requirements-SISKOP.md` — detailed FR/NFR source for every desktop equivalent cited
  in §7
- `docs/03-ERD-SISKOP.md`, `docs/04-System-Architecture-SISKOP.md`, `docs/05-DB-Schema-SISKOP.md` —
  data model and backend architecture, reused as-is (§10)
- `docs/07-System-Architecture-SISKOP-Mobile-Version.md` — the detailed mobile architecture this
  document's §10 summarizes
- `CLAUDE.md` — non-negotiable rules (tenant isolation, Decimal money, API envelope) that apply
  identically to any new mobile-facing route
