# 01 — Product Requirements Document (PRD): SISKOP (v2)

Status: living document, updated **2026-09-11** against the current codebase. Owner: Product
Manager (see `docs/claude-integration/PM-INSTRUCTIONS.md`). Engineer, QA, and Ops co-sign their
sections per the team model in `CLAUDE.md`. **v2 of this document — kept as a separate file from
`docs/01-PRD-SISKOP.md` ("v1", dated 2026-07-29) rather than overwriting it**, since the amount of
change since v1 (a reversed product decision, two QA cycles with a No-Go finding, and a large
unmerged initiative) is large enough to be worth diffing against, not just superseding in place.
Treat this file as authoritative going forward; v1 is retained for history only.

## What changed since v1 (2026-07-29)

1. **Members can now log in.** v1 §3/§9 stated members "never log in" as a deliberate, ratified
   product decision. That decision is **reversed**: `feat: add Anggota mobile self-service portal`
   (`4c46ee0`, 2026-08-27) shipped a member-facing login (NIK + birthdate-derived password) on
   `apps/mobile`. See §3 and §9.1 below — this is the single largest change in this revision.
2. **SISKOP Mobile (staff, read-only) shipped and merged** — Dashboard, Anggota, Simpanan,
   Pinjaman (incl. Anggota Menunggak), Profil, and all 5 Laporan Regulasi (Neraca, Arus Kas,
   Laporan Hasil Usaha, Pembagian SHU, CALK), per `docs/06-PRD-SISKOP-Mobile-Version.md` Fase 1.
   Merged via PR #1 (`61cc34f`). See §5.
3. **Two QA cycles executed, current release recommendation is No-Go.** Cycle 1 (2026-08-27) found
   3 P0 defects in Savings and 1 P1 in Auth. Cycle 2 (2026-09-11) re-confirmed all four still open
   and found a new P0 in the member portal (default password mechanically derivable from a
   member's own NIK, with no server-side enforcement of the forced-password-change flag). See §7.1.
4. **A KSU (multi-unit) + Konsumen (Toko/POS/PPOB) MVP has been built ahead of schedule, but is not
   merged to `main` and not part of the committed roadmap yet.** Three feature branches
   (`feature/ksu-mvp-week1-spike`, `feature/ksu-mvp-full-stack`, `feature/toko-rbac-unit-scoping`)
   contain a working spike: consolidated cross-unit reporting, per-unit member SHU statements, a
   full Konsumen POS module (products, stock, sales, balanced journal posting), a PPOB stub, and
   unit-scoped RBAC. This is pre-work ahead of a tentatively planned Jan 2027 KSU engineering start
   referenced in-repo as "SD-001" — **that decision has not yet been logged to `CLAUDE.md` under a
   Strategic Decisions section**, so treat SD-001 as proposed, not ratified. See §4b (new).

## 1. Problem statement

Indonesian cooperatives (koperasi) — savings-and-loan (KSP), consumer (Konsumen), producer
(Produsen), service (Jasa), marketing (Pemasaran), and multi-unit combinations (koperasi serba
usaha, KSU) — largely run their member ledgers, savings accounts, and loan books on spreadsheets
or single-tenant desktop software. That makes multi-branch consolidation, SHU (sisa hasil usaha /
annual surplus) distribution, and regulatory reporting slow and error-prone, and leaves no
tenant-isolated way for a software vendor to serve many cooperatives from one system. It also
leaves individual members with no way to check their own savings/loan standing without contacting
staff directly.

SISKOP is a multi-tenant SaaS platform: one deployment serves many koperasi ("tenants"), each with
its own subdomain, its own members, its own financial ledger, and its own assigned subscription
package, while sharing the same application and database instance. Staff use a desktop-oriented
web app; as of this revision, both staff and members also have a phone-optimized web app
(`apps/mobile`) — staff read-only reporting/lookup, members a self-service view of their own
account (§5).

## 2. Goals

Product goals, carried from `docs/claude-integration/PM-INSTRUCTIONS.md`:

| Goal | Target |
|---|---|
| Tenant adoption | 50 koperasi onboarded |
| Customer satisfaction | NPS ≥ 7 |
| Platform availability | 99.5% uptime |
| Dashboard responsiveness | < 3s load |
| API responsiveness | < 500ms (p99) — **currently missed on login specifically, see §7.1 D5** |

Non-goals for the current phase (not committed, not in the schema or codebase):

- Payment gateway integration (bank transfer / e-wallet settlement) — subscription packages exist
  and can be assigned, but nothing collects payment for one yet. A PPOB (bill-payment) stub exists
  only on the unmerged KSU branches (§4b) and is simulated, not a real biller integration.
- Mobile native apps (app-store distribution) — both mobile surfaces shipped so far are responsive
  web (PWA-shaped), per `docs/06-PRD-SISKOP-Mobile-Version.md` Fase 1; native/Capacitor packaging
  (Fase 2) remains conditional and unscheduled, unchanged from v1.
- Government/regulatory e-filing integration (e.g. to Kemenkop UKM systems) — the regulatory
  *reports* (Neraca, Arus Kas, etc.) are implemented on both desktop and mobile; submitting them
  anywhere is not.
- Multi-currency (Rupiah only; no money field carries a currency code)
- Multi-unit (KSU) / Konsumen POS as a released feature — a full spike exists (§4b) but nothing
  from those branches has merged to `main`; this remains a non-goal for the *current released
  product* even though active engineering exists against it.

## 3. Users and roles

Roles as implemented in `packages/types/src/user.ts` (`UserRole`, the coarse JWT claim, staff-only)
and `packages/types/src/role.ts` (`Permissions`, the fine-grained per-tenant RBAC):

| Role | Who | Scope |
|---|---|---|
| `super_admin` | SISKOP platform operator | Cross-tenant — Platform Admin console (`/platform/*`): tenant list/provisioning, subscription package management, platform-admin-user management. **Confined to that console only** — cannot browse into any single tenant's business modules, even the tenant their own `User` row happens to be attached to (see §4a) |
| `tenant_admin` | Koperasi pengurus (management) | All active units within their tenant; fine-grained access further scoped by their assigned `Role`'s `permissions` blob |
| `accountant` | Koperasi bendahara (treasurer/bookkeeper) | All active units within their tenant — derived when the assigned `Role.name` is "Teller" or "Viewer" |
| `member` | Koperasi anggota (member) | Coarse `UserRole` value for staff-side JWTs; `deriveUserRole()` still never produces it for a `User` row — unchanged from v1. **Members now have their own, entirely separate login (see below) — this row describes the staff-claim enum only, not whether a member can authenticate.** |

**v1 stated members "never log in." That is no longer true.** `feat: add Anggota mobile
self-service portal` (`4c46ee0`) added a member-facing login that is deliberately **not** the
`member` `UserRole` above — it is a second, parallel authentication system:

- A `Member` (not a `User`) logs in with their **NIK + password** (not email) against
  `POST /api/member-auth/login`, receiving a distinct JWT shape (`MemberAuthClaims`:
  `{ memberId, tenantId, role: "member" }` — no `permissions`/`unitIds`) that staff-session
  middleware and member-session middleware each reject if presented to the other's routes.
- The initial/reset password is deterministic: `DDMMYYYY` of the member's own `birthDate`
  (`defaultPasswordFromBirthDate()`, `apps/backend/src/modules/member-auth/service.ts`), set by
  staff via a "activate/reset portal access" action on the desktop Member Detail page, with a
  `mustChangePassword` flag intended to force a change on first use.
- **This flag is not currently enforced server-side** — a live, unfixed P0 finding (D6, §7.1): any
  request carrying a valid member JWT can read that member's real dashboard/savings/loans data
  regardless of `mustChangePassword`, and Indonesia's public NIK-encodes-birthdate convention makes
  the default password computable from the NIK alone (which staff already hold on file for every
  member) without ever separately learning the birthdate. **Do not treat member self-service as
  safe for real financial data until this is closed** — see §7.1 and §9.1 for the product decision
  this forces.
- Scope, once authenticated, is read-only and strictly own-record: profile, own savings
  (list + per-account transaction history), own loans (list + detail). No write endpoints exist for
  members. Ownership is enforced per-request (`assertOwnsMember` in
  `apps/backend/src/modules/member-portal/service.ts`), not just at login.

A person's staff login identity (`User`) remains distinct from their cooperative membership
(`Member`) — unchanged from v1 — except that `Member` now optionally also has *its own* login,
which is a third identity axis, not a merging of the first two.

**Platform admins are `User` rows with `isPlatformAdmin = true`.** Unchanged from v1 — see §4a.

## 4. Core product concept: tenant, unit, and "KSU"

Unchanged from v1. Every tenant is a single koperasi with one or more `CooperativeUnit`s. A
**koperasi serba usaha (KSU)** — a cooperative running several lines of business at once — is not a
distinct type; it is a tenant with more than one active unit (`isMultiUnit()` in
`packages/types/src/unit.ts`). This is a deliberate product decision (`CLAUDE.md` rule 2b): it
keeps `if (type === 'KSU')` branching out of member enrollment, savings/loan scoping, SHU
distribution, and reporting. **As released** (on `main`), every provisioned tenant still has
exactly one unit — nothing merged to `main` yet exercises the multi-unit path in production. See
§4b for what exists off-`main`.

Unit types implemented in the schema (`CooperativeType`): `KSP` (simpan pinjam / savings & loan),
`KONSUMEN` (consumer goods), `PRODUSEN` (producer), `JASA` (services), `PEMASARAN` (marketing).

Tenants are addressed by subdomain (`Tenant.slug`), resolved from the request's `Host` header,
never from user input in the request body — see `docs/04-System-Architecture-SISKOP.md` §5. This
now also governs member-auth login (§3): `loginMember()` resolves the tenant the same way,
via `slugFromHost`, so a member cannot name which tenant they authenticate against either.

### 4a. Platform vs. tenant separation (added 2026-07-29, unchanged since)

The SaaS operator (`super_admin`) and a cooperative's own staff remain architecturally distinct
axes; see v1 §4a for the full rationale — no change this revision.

### 4b. KSU + Konsumen (Toko/POS) MVP spike — built, not merged, not committed (new in v2)

Ahead of a tentatively planned "Jan 2027 KSU engineering start" (referenced in-repo as SD-001,
**not yet logged to `CLAUDE.md` under a Strategic Decisions section — treat as proposed, not
ratified**), a de-risking spike was carried substantially further than a spike, across three
unmerged branches:

| Branch | Contains |
|---|---|
| `feature/ksu-mvp-week1-spike` | Baseline-behavior lock for existing single-unit tenants; explicit `unitId` on loan creation (defaulting to existing behavior); read-only consolidated asset reporting across units; per-unit member SHU statement; unit loan-volume threshold check; a KSU demo seed |
| `feature/ksu-mvp-full-stack` | Everything above, plus a full Konsumen module: `Product`/`POSSale`/`StockMovement`/`PPOBTransaction` schema (additive), product CRUD + stock-movement tracking, POS sale posting with stock decrement and a balanced journal entry, a PPOB check-and-pay skeleton against a simulated biller, and matching frontend (unit layout, product/stock pages, POS cart/checkout, PPOB screen, units + consolidated-report + member-statement pages gated by `isMultiUnit`) |
| `feature/toko-rbac-unit-scoping` | A Toko-only "Kasir" role closing a module-permission gap, and per-user unit scoping enforced fresh on every Konsumen request |

Planning detail lives in `docs/2026-09-10-ksu-mvp-week1.md` (5-day plan), its compressed 2-day
variant, and `docs/ksu-konsumen-backend.md` / `docs/ksu-konsumen-frontend.md` / `docs/ksu-mvp-frontend.md`.

**Product framing:** this is real, tested engineering (the spike explicitly locks existing
single-unit behavior via a dedicated baseline test before adding anything), but it is **not** a
committed roadmap item in this document — no PM sign-off is on record for merging it, and §2's
non-goals list still excludes KSU/Konsumen as *released* functionality. Flag to PM: either
(a) ratify SD-001 and schedule the merge, or (b) explicitly park these branches, so the gap between
"exists in the repo" and "product-approved" doesn't silently drift.

## 5. Modules and current status

Module list per `CLAUDE.md` "Module ownership" plus the two mobile surfaces added since v1. Status
reflects `main` only — §4b's unmerged work is intentionally excluded from this table.

| Module | Status | Evidence |
|---|---|---|
| Auth | Implemented — **QA-flagged, see §7.1 D4** | `apps/backend/src/modules/auth/` — self-service register, subdomain login, refresh, `/me`, self-service profile/password |
| Tenant provisioning | Implemented | `apps/backend/src/modules/tenants/provision.ts` |
| Dashboard | Implemented | `apps/backend/src/modules/dashboard/`, `pages/dashboard/DashboardPage.tsx` |
| Members | Implemented — **QA-flagged, see §7.1 D6** | `apps/backend/src/modules/members/` — create/list/detail, KTP upload, plus (new) portal-access activation/reset |
| Savings | Implemented — **QA-flagged, see §7.1 D1-D3, release-blocking** | `apps/backend/src/modules/savings/` |
| Loans | Implemented | `apps/backend/src/modules/loans/` — configurable products, issuance, repayment, automatic KOL reclassification |
| Accounting / ledger | Implemented | Chart of Accounts, account mappings, automatic double-entry posting engine (`lib/journal.ts`) |
| Reports | Implemented | Financial (RPT-01/02) + full regulatory suite (Neraca/Arus Kas/Laporan Hasil Usaha/Pembagian SHU/CALK) per Permenkop UKM No. 2/2024, PDF export |
| Config | Implemented | Units, Roles, Users, Chart of Accounts, Account Mappings, SHU config, Whitelabel, Modal Disetor |
| Users (Pengguna) | Implemented | `apps/backend/src/modules/users/` — tenant-scoped staff CRUD |
| Platform Admin | Implemented | Tenant list/provisioning/package-assignment, subscription package CRUD, platform-admin-user CRUD |
| **Mobile — staff (read-only)** *(new since v1)* | **Implemented** | `apps/mobile` — Dashboard, Anggota (Members), Simpanan (Savings), Pinjaman incl. Anggota Menunggak (Loans/Overdue), Profil, all 5 Laporan Regulasi. Per `docs/06-PRD-SISKOP-Mobile-Version.md` Fase 1, merged via PR #1 (`61cc34f`) |
| **Mobile — Anggota self-service (read-only)** *(new since v1)* | **Implemented, but P0 security defect open — not release-ready, see §7.1 D6** | `apps/mobile` member routes (`/anggota/*`) + `apps/backend/src/modules/member-auth`, `modules/member-portal` (`4c46ee0`) |
| KSU / Konsumen (Toko+POS+PPOB) | **Not on `main`** — spike/build complete on 3 unmerged branches | See §4b |

Backend test coverage: **233/233 tests passing, 18 files, 93.19% lines** (above the 80% gate) as of
`main`@`4c46ee0` — up from v1's 209 tests / 93.43% (line-coverage % moved slightly with new code,
not a regression; see `docs/qa-cycle2-2026-09-11/Test Result.md` §1). Frontend and mobile still
have no automated test suite (unchanged from v1; NFR-TEST-07).

## 6. Functional requirements (high-level)

Detailed, testable requirements live in `docs/02-System-Requirements-SISKOP.md`. Unchanged summary
from v1 for Auth/Dashboard/Members/Savings/Loans/Accounting/Reports/Config/Platform Admin — see v1
§6 for the full per-module text, not repeated here. New since v1:

- **Mobile (staff)**: phone-optimized, read-only views of the same tenant data desktop staff see —
  Dashboard, Members, Savings, Loans (incl. Anggota Menunggak), Profil, and all 5 regulatory
  reports. No write paths; no backend/schema changes were required to ship it
  (`docs/06-PRD-SISKOP-Mobile-Version.md` §9-10).
- **Mobile (Anggota self-service)**: a member logs in with NIK + password (staff-issued, birthdate-
  derived default), views their own profile/savings/loan balances and history, and must be able to
  change their password. **Product requirement not yet met in practice**: the "must change password
  on first login" behavior implied by the UI copy is not server-enforced (§3, §7.1 D6) — closing
  that gap is a functional requirement of this feature, not an optional hardening pass.

## 7. Non-functional requirements

See `docs/02-System-Requirements-SISKOP.md` for the full, testable list. Headlines, updated:

- API p99 < 500ms · dashboard load < 3s · PDF export < 10s — **login specifically now measured and
  missing this target** (~790-920ms, bcrypt-cost-bound; see §7.1 D5). No load testing/APM exists.
- 99.5% uptime · RTO < 1h · RPO < 15min · daily backups with a tested restore — still no
  backup/deploy infrastructure in this repo, unchanged from v1.
- Multi-tenant data isolation is a release-blocking test category — re-verified in QA Cycle 2 with
  no regressions, including the new member-portal cross-tenant NIK scoping.
- Money is always `Decimal`, never float (`CLAUDE.md` rule 2) — unchanged.
- Backend test coverage: **93.19% lines, 233 tests, 18 files** (§5) — above the 80% gate.

### 7.1 QA status: two cycles executed, current recommendation is **No-Go** (new in v2)

This is new since v1, which predated any formal QA execution. Full detail: `docs/08-QA-Test-Plan-SISKOP.md`
(plan), `docs/09-QA-Test-Cases-SISKOP.md` (172 traceable cases + Cycle 1 results), and
`docs/qa-cycle2-2026-09-11/` (Cycle 2, re-verification + the new mobile-portal pass).

| ID | Severity | Status | Module | Summary |
|---|---|---|---|---|
| D1 | P0 | **Open** | Savings | Opening a Wajib/Sukarela saving never checks the member has an active Pokok saving first |
| D2 | P0 | **Open** | Savings | Simpanan Pokok can be withdrawn all the way to zero |
| D3 | P0 | **Open** | Savings | A member can open unlimited duplicate savings for the same product |
| D4 | P1 | **Open** | Auth | Tenant registration doesn't reject an admin email already used by another tenant |
| D5 | P2 (informational) | **Open** | Auth / Perf | Login latency (~790-920ms) exceeds the 500ms p99 NFR target — looks bcrypt-cost-bound |
| D6 | **P0** | **New in Cycle 2** | Member Portal (mobile) | Default member-portal password is mechanically derivable from the member's own NIK; `mustChangePassword` is never enforced server-side — a member's real financial data is exposed before they ever log in |

**QA's release recommendation is No-Go**, unchanged across both cycles, because D1-D3 (money/
membership-integrity) and D6 (auth bypass exposing real financial data) are each independently
release-blocking per the test plan's severity table (§3.3 there), regardless of any other finding.
Every FR status of "Implemented" elsewhere in this document (§5, §6) describes what is *built*, not
a QA-verified sign-off — D1-D3/D6 show that "implemented" and "correct" have diverged in Savings and
the new member portal specifically. PM/Engineer should treat closing D1-D3 and D6 as a precondition
to any release announcement that includes Savings or the member self-service portal, not a
follow-up item.

## 8. Subscription & entitlement model

Unchanged from v1 — no entitlement changes shipped since 2026-07-29. See v1 §8 for the full text:
`SubscriptionPackage` model, base-modules-free / accounting+whitelabel gated via
`requireAccountingEntitlement`/`requireWhitelabelEntitlement`, quota fields unenforced. Neither
mobile surface (§5) introduces a new entitlement check — both ride on the same tenant/package the
desktop app already resolved.

## 9. Open product decisions

Carried and extended from v1 — ratified technical decisions with product consequences, listed here
so PM/QA/Ops don't re-litigate them without cause. Items 1-4, 6-8 are **unchanged from v1** (see v1
§9 for full text): no `KSU` enum value; "≥1 unit per tenant" enforced in application code; unit
access rides in the JWT with up to 15-minute propagation; login identifies the tenant by subdomain;
refresh tokens are stateless JWTs; a tenant with no subscription package gets no add-on
entitlements; platform admins are architecturally confined to the Platform Admin console.

### 9.1 Item 5 — reversed (new in v2)

v1 item 5 read: *"Members have no login at all... Revisit if member self-service (viewing their own
balance, say) becomes a goal."* That revisit has happened: `4c46ee0` shipped exactly that. This
replaces v1 item 5:

5. **Members have their own login, separate from staff `User` accounts** (§3) — NIK + birthdate-
   derived password, read-only scope, own-record-only. **This decision is currently shipped but not
   QA-cleared**: the forced-password-change control it depends on for safety is unenforced (D6,
   §7.1), making the feature's actual security posture worse than "no member login at all" for any
   member whose NIK is known to someone untrusted. PM/Engineer must decide, before wider rollout,
   between (a) shipping the two fixes QA suggested (enforce `mustChangePassword` server-side;
   replace the NIK-derivable default with an out-of-band or higher-entropy one) or (b) disabling the
   feature until fixed. Silently leaving it live with known bypass details documented in this repo
   is not a neutral option.

### 9.2 New this revision

9. **KSU/Konsumen (Toko+POS+PPOB) exists as a working spike on unmerged branches, not as a
   committed feature** (§4b). Treat SD-001 (a tentative Jan 2027 engineering start) as proposed
   until it is actually logged to `CLAUDE.md`'s Strategic Decisions — PM should either ratify and
   schedule it or explicitly park the branches so this doesn't drift into an undocumented parallel
   roadmap.

## 10. Success metrics and instrumentation gap

Unchanged from v1: the PM targets in §2 (uptime, latency, NPS, onboarded-tenant count) still have no
instrumentation — no metrics/analytics pipeline exists in the codebase (see
`docs/04-System-Architecture-SISKOP.md` §9, "Observability"). Still a gap to close, not a
documentation oversight to ignore.

## 11. Related documents

- `docs/01-PRD-SISKOP.md` — v1 of this document (2026-07-29), retained for history
- `docs/02-System-Requirements-SISKOP.md` — detailed functional & non-functional requirements
- `docs/03-ERD-SISKOP.md` — entity-relationship diagram
- `docs/04-System-Architecture-SISKOP.md` — system architecture
- `docs/05-DB-Schema-SISKOP.md` — database schema reference
- `docs/06-PRD-SISKOP-Mobile-Version.md` — mobile-specific PRD, additive to this document
- `docs/07-System-Architecture-SISKOP-Mobile-Version.md` — mobile system architecture
- `docs/08-QA-Test-Plan-SISKOP.md`, `docs/09-QA-Test-Cases-SISKOP.md` — QA plan, cases, and Cycle 1 results
- `docs/qa-cycle2-2026-09-11/` — QA Cycle 2 (defects, results, cases)
- `docs/2026-09-10-ksu-mvp-week1.md`, `docs/2026-09-10-ksu-mvp-compressed-2day.md`,
  `docs/ksu-konsumen-backend.md`, `docs/ksu-konsumen-frontend.md`, `docs/ksu-mvp-frontend.md` — KSU
  MVP spike planning (§4b), unmerged
- `docs/claude-integration/PM-INSTRUCTIONS.md` — PM decision authority and targets
