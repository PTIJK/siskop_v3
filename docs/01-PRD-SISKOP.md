# 01 — Product Requirements Document (PRD): SISKOP

Status: living document, updated **2026-07-29** against the current codebase. Owner: Product
Manager (see `docs/claude-integration/PM-INSTRUCTIONS.md`). Engineer, QA, and Ops co-sign their
sections per the team model in `CLAUDE.md`. Supersedes the 2026-07-28 version of this document,
which described a scaffold where only Auth and tenant provisioning existed — Members, Savings,
Loans, Dashboard, Accounting/Reports, Config, Users, and Platform Admin have all shipped since.

## 1. Problem statement

Indonesian cooperatives (koperasi) — savings-and-loan (KSP), consumer (Konsumen), producer
(Produsen), service (Jasa), marketing (Pemasaran), and multi-unit combinations (koperasi serba
usaha, KSU) — largely run their member ledgers, savings accounts, and loan books on spreadsheets
or single-tenant desktop software. That makes multi-branch consolidation, SHU (sisa hasil usaha /
annual surplus) distribution, and regulatory reporting slow and error-prone, and leaves no
tenant-isolated way for a software vendor to serve many cooperatives from one system.

SISKOP is a multi-tenant SaaS platform: one deployment serves many koperasi ("tenants"), each with
its own subdomain, its own members, its own financial ledger, and its own assigned subscription
package, while sharing the same application and database instance.

## 2. Goals

Product goals, carried from `docs/claude-integration/PM-INSTRUCTIONS.md`:

| Goal | Target |
|---|---|
| Tenant adoption | 50 koperasi onboarded |
| Customer satisfaction | NPS ≥ 7 |
| Platform availability | 99.5% uptime |
| Dashboard responsiveness | < 3s load |
| API responsiveness | < 500ms (p99) |

Non-goals for the current phase (not committed, not in the schema or codebase):

- Payment gateway integration (bank transfer / e-wallet settlement) — subscription packages exist
  and can be assigned, but nothing collects payment for one yet
- Mobile native apps (the frontend is a responsive web app only)
- Government/regulatory e-filing integration (e.g. to Kemenkop UKM systems) — the regulatory
  *reports* (Neraca, Arus Kas, etc.) are implemented; submitting them anywhere is not
- Multi-currency (Rupiah only; no money field carries a currency code)

## 3. Users and roles

Roles as implemented in `packages/types/src/user.ts` (`UserRole`, the coarse JWT claim) and
`packages/types/src/role.ts` (`Permissions`, the fine-grained per-tenant RBAC):

| Role | Who | Scope |
|---|---|---|
| `super_admin` | SISKOP platform operator | Cross-tenant — Platform Admin console (`/platform/*`): tenant list/provisioning, subscription package management, platform-admin-user management. **Confined to that console only** — cannot browse into any single tenant's business modules, even the tenant their own `User` row happens to be attached to (see §4a) |
| `tenant_admin` | Koperasi pengurus (management) | All active units within their tenant; fine-grained access further scoped by their assigned `Role`'s `permissions` blob |
| `accountant` | Koperasi bendahara (treasurer/bookkeeper) | All active units within their tenant — derived when the assigned `Role.name` is "Teller" or "Viewer" |
| `member` | Koperasi anggota (member) | **Never logs in.** A deliberate divergence from the original scaffold, which modeled a mandatory 1:1 `Member ↔ User`: members are managed by staff, they have no credentials of their own. This `UserRole` value exists in the type system but `deriveUserRole()` never produces it |

A person's login identity (`User`) is distinct from their cooperative membership (`Member`, which
has no login at all — see above). Within one tenant, a `User`'s fine-grained access comes from the
tenant-scoped `Role` they're assigned (seeded per tenant: Super Admin/Manager/Teller/Viewer, plus
any custom roles the tenant creates); `deriveUserRole()` maps that onto the coarse `UserRole` used
for platform-wide gating.

**Platform admins are `User` rows with `isPlatformAdmin = true`.** They still need a `tenantId`/
`roleId` to satisfy `User`'s FK constraints (see `docs/05-DB-Schema-SISKOP.md` §3.5) — provisioned
by attaching them to the creating admin's own tenant/role. This is an implementation artifact, not
intent: the frontend explicitly hides that tenant's business modules from them and redirects any
direct URL navigation into one back to `/platform/tenants` (added 2026-07-29 after this exact
confusion was caught in review — a platform admin's sidebar was showing Dashboard/Anggota/
Simpanan/Pinjaman/Laporan/Konfigurasi, implying they administered the demo cooperative, which was
never the intent).

## 4. Core product concept: tenant, unit, and "KSU"

Every tenant is a single koperasi with one or more `CooperativeUnit`s. A **koperasi serba usaha
(KSU)** — a cooperative running several lines of business at once — is not a distinct type; it is
a tenant with more than one active unit (`isMultiUnit()` in `packages/types/src/unit.ts`). This is
a deliberate product decision (`CLAUDE.md` rule 2b): it keeps `if (type === 'KSU')` branching out
of member enrollment, savings/loan scoping, SHU distribution, and reporting. In practice, every
tenant provisioned so far (self-service or platform-admin-created) has exactly one unit — Phase 1
never surfaced a "create a second unit" UI path in the registration/provisioning flow, only in
Konfigurasi post-registration (`pages/config/UnitsTab.tsx`).

Unit types implemented (`CooperativeType`): `KSP` (simpan pinjam / savings & loan), `KONSUMEN`
(consumer goods), `PRODUSEN` (producer), `JASA` (services), `PEMASARAN` (marketing).

Tenants are addressed by subdomain (`Tenant.slug`, e.g. `demo.localhost:3000`), resolved from the
request's `Host` header, never from user input in the request body — see
`docs/04-System-Architecture-SISKOP.md` §5 for why this is a hard security boundary.

### 4a. Platform vs. tenant separation (added 2026-07-29)

The SaaS operator (`super_admin`) and a cooperative's own staff are architecturally distinct axes,
and the product must keep them visibly distinct, not just technically isolated:

- A platform admin manages *the SaaS business* — which koperasi exist, what package each one is on,
  who else administers the platform. They have no legitimate reason to see a specific koperasi's
  members, savings, loans, or reports, and the UI must not imply otherwise.
- This matters because of how platform admins are provisioned (§3): the FK-satisfying tenant/role
  attachment technically grants them real, working permissions against that one tenant's data.
  "Technically has access" and "the product should let them use it" are different questions — the
  answer to the second is no, enforced client-side (route guard + hidden nav) since 2026-07-29.

## 5. Modules and current status

Module list per `CLAUDE.md` "Module ownership". Status reflects the actual repository.

| Module | Status | Evidence |
|---|---|---|
| Auth | Implemented | `apps/backend/src/modules/auth/` — self-service register, subdomain login, refresh, `/me`, self-service profile/password |
| Tenant provisioning | Implemented | `apps/backend/src/modules/tenants/provision.ts` — shared by self-service registration and platform-admin tenant creation |
| Dashboard | **Implemented** *(was: not started)* | `apps/backend/src/modules/dashboard/`, `pages/dashboard/DashboardPage.tsx` |
| Members | **Implemented** *(was: schema only)* | `apps/backend/src/modules/members/` — create/list/detail, KTP upload, no login (Member has no User relationship at all — see §3) |
| Savings | **Implemented** *(was: schema only)* | `apps/backend/src/modules/savings/` — configurable products (`SavingConfig`) + per-member instances (`Saving`) + deposit/withdrawal ledger (`SavingTransaction`) |
| Loans | **Implemented** *(was: schema only)* | `apps/backend/src/modules/loans/` — configurable products, issuance, repayment, automatic KOL reclassification |
| Accounting / ledger | **Implemented** *(was: schema only, as a flat unused `Transaction` table)* | Chart of Accounts, account mappings, and an automatic double-entry posting engine (`lib/journal.ts`) replace the original flat, never-written-to `Transaction` model |
| Reports | **Implemented** *(was: not started)* | Financial (RPT-01/02) + full regulatory suite (Neraca/Arus Kas/Laporan Hasil Usaha/Pembagian SHU/CALK) per Permenkop UKM No. 2/2024, all with PDF export |
| Config | **Implemented** *(was: not started)* | Units, Roles, Users, Chart of Accounts, Account Mappings, SHU config, Whitelabel, Modal Disetor — 8 tabs on one `ConfigPage` |
| Users (Pengguna) | **Implemented** *(new module — not previously listed)* | `apps/backend/src/modules/users/` — tenant-scoped staff CRUD, distinct from self-service profile editing (Auth) and from Platform Admin's cross-tenant admin-user CRUD |
| Platform Admin | **Implemented** *(was: not started)* | Tenant list/provisioning/package-assignment, subscription package CRUD, platform-admin-user CRUD — see `docs/02-System-Requirements-SISKOP.md` §1.9 |

Every module above has an automated backend test file (`apps/backend/tests/*.test.ts`) except
where noted; frontend still has no automated test suite (§9 in
`docs/02-System-Requirements-SISKOP.md`).

## 6. Functional requirements (high-level)

Detailed, testable requirements live in `docs/02-System-Requirements-SISKOP.md`. Summary by
module:

- **Auth**: self-service tenant registration; subdomain-based login; JWT access/refresh session;
  `/me`; self-service profile edit and password change; platform-admin authentication (same login
  flow, gated by `isPlatformAdmin`).
- **Dashboard**: tenant-scoped summary (member count, savings totals, loan portfolio health,
  recent activity).
- **Members**: create/list members with KTP upload, enroll into the tenant's unit; status via
  soft-delete (`isActive`), not a multi-value lifecycle.
- **Savings**: tenant-configurable products (Pokok/Wajib/Sukarela) via `SavingConfig`; per-member
  balances (`Saving`) with deposit/withdrawal (`SavingTransaction`); Simpanan Pokok cannot be
  withdrawn to closed.
- **Loans**: tenant-configurable products via `LoanConfig` (konvensional interest or syariah flat
  margin); issuance with computed amortization; repayment tracking; automatic KOL reclassification
  by days-overdue.
- **Accounting**: tenant-configurable Chart of Accounts and account mappings; every Savings/Loans
  transaction auto-posts a balanced double-entry journal entry (or a fixable
  `UNPOSTED_MISSING_MAPPING` if no mapping exists yet).
- **Reports**: financial + RAT aggregate reports; full Permenkop UKM No. 2/2024 regulatory suite
  (Neraca, Arus Kas, Laporan Hasil Usaha, Pembagian SHU, CALK), all ledger-derived, all with PDF
  export except CALK.
- **Config**: units, fine-grained roles, tenant staff users, Chart of Accounts, account mappings,
  SHU distribution formula, whitelabel branding, modal disetor compliance field.
- **Platform Admin**: cross-tenant tenant list/provisioning/package assignment, subscription
  package CRUD, platform-admin-user CRUD — confined to its own console, no bleed into tenant data
  (§4a).

## 7. Non-functional requirements

See `docs/02-System-Requirements-SISKOP.md` for the full, testable list. Headlines:

- API p99 < 500ms · dashboard load < 3s · PDF export < 10s (still unmeasured — no load
  testing/APM exists)
- 99.5% uptime · RTO < 1h · RPO < 15min · daily backups with a tested restore (still no
  backup/deploy infrastructure in this repo)
- Multi-tenant data isolation is a release-blocking test category, now with a cross-tenant
  leakage test in every module's test file
- Money is always `Decimal`, never float (`CLAUDE.md` rule 2)
- Backend test coverage: 93.43% lines (209 tests), above the 80% gate

## 8. Subscription & entitlement model

Replaces the 2026-07-28 version of this section, which described an unused `Tenant.subscriptionTier`
string column. That column no longer exists — the actual implementation is a proper
`SubscriptionPackage` model, assignable per tenant:

- A `SubscriptionPackage` has a name, price, a list of entitled add-on `modules` (currently only
  `"accounting"` means anything), a `whitelabelEnabled` flag, and unenforced quota fields
  (`maxUsers`/`maxMembers`/`maxSavingConfigs`).
- **A tenant with no package assigned (`packageId: null`) gets base modules only** — Members,
  Savings, Loans, Dashboard, and the plain financial/RAT reports are never gated. Chart of Accounts,
  Account Mappings, SHU config, all regulatory reports, and Whitelabel *writes* require the tenant's
  package to include the relevant entitlement (`requireAccountingEntitlement` /
  `requireWhitelabelEntitlement`, `apps/backend/src/middleware/entitlement.ts`).
- Self-service tenant registration still assigns no package by default (unchanged) — a platform
  admin assigns one after the fact via the "Kelola" action on `PlatformTenantsPage`. **This is a
  product judgment call made without PM sign-off**, not a specification: flag it if the intended
  business model is instead "every signup gets a trial package automatically."
- A blocked entitlement is a normal, user-visible error (`FEATURE_NOT_ENTITLED`, HTTP 403) with a
  specific message ("Paket langganan Anda tidak mengaktifkan modul akuntansi") — not a bare 403, not
  a silently-empty page.
- Quota fields exist but are not enforced anywhere yet; pricing/plan-tier definitions remain a PM
  decision (packages are currently seeded ad hoc — one "Paket Lengkap (Demo)" package — not a
  product-defined tier ladder).

## 9. Open product decisions

Carried and extended from prior versions — ratified technical decisions with product consequences,
listed here so PM/QA/Ops don't re-litigate them without cause:

1. **No `KSU` enum value.** A koperasi serba usaha is derived (`units.length > 1`), not stored.
2. **"≥1 unit per tenant" is enforced in application code**, not a database constraint. Regression
   coverage is `apps/backend/tests/provision-tenant.test.ts`.
3. **Unit access rides in the JWT** (`unitIds` claim). A staff member's access change takes up to
   15 minutes to take effect.
4. **Login identifies the tenant by subdomain**, not a "kode koperasi" login-form field.
5. **Members have no login at all** (changed from the original scaffold's mandatory 1:1
   `Member ↔ User`) — a product decision made when the pre-rescaffold KSP system was merged in,
   matching that system's staff-manage-everything model rather than a member self-service portal.
   Revisit if member self-service (viewing their own balance, say) becomes a goal.
6. **Refresh tokens are stateless** (a signed JWT, not a DB-backed, revocable row) — a considered
   trade-off (see `docs/04-System-Architecture-SISKOP.md` §6), not an oversight. Revisit if
   session revocation (e.g. "log out all devices") becomes a requirement.
7. **A tenant with no subscription package gets no add-on entitlements**, not full/unrestricted
   access (§8) — made without explicit PM sign-off; flag if the intended default is different.
8. **Platform admins are architecturally confined to the Platform Admin console** (§4a) — a
   product/UX decision, not just an access-control one: even where their session technically could
   reach tenant data, the product should never present that as a legitimate path.

## 10. Success metrics and instrumentation gap

The PM targets above (uptime, latency, NPS, onboarded-tenant count) still have no instrumentation —
there is no metrics/analytics pipeline in the codebase (see
`docs/04-System-Architecture-SISKOP.md` §9, "Observability"). Unchanged from the prior version of
this document; still a gap to close, not a documentation oversight to ignore.

## 11. Related documents

- `docs/02-System-Requirements-SISKOP.md` — detailed functional & non-functional requirements
- `docs/03-ERD-SISKOP.md` — entity-relationship diagram
- `docs/04-System-Architecture-SISKOP.md` — system architecture
- `docs/05-DB-Schema-SISKOP.md` — database schema reference
- `docs/claude-integration/PM-INSTRUCTIONS.md` — PM decision authority and targets
