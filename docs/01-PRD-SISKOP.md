# 01 — Product Requirements Document (PRD): SISKOP

Status: living document, written against the codebase as of 2026-07-28 (commit `93e0f1b`).
Owner: Product Manager (see `docs/claude-integration/PM-INSTRUCTIONS.md`). Engineer, QA, and
Ops co-sign their sections per the team model in `CLAUDE.md`.

This fills the gap `SETUP-VERIFICATION.md` flagged under "Known gaps": the scaffolding plan
referenced `01-PRD-SISKOP.md` but never created it.

## 1. Problem statement

Indonesian cooperatives (koperasi) — savings-and-loan (KSP), consumer (Konsumen), producer
(Produsen), service (Jasa), marketing (Pemasaran), and multi-unit combinations (koperasi serba
usaha, KSU) — largely run their member ledgers, savings accounts, and loan books on spreadsheets
or single-tenant desktop software. That makes multi-branch consolidation, SHU (sisa hasil usaha /
annual surplus) distribution, and regulatory reporting slow and error-prone, and leaves no
tenant-isolated way for a software vendor to serve many cooperatives from one system.

SISKOP is a multi-tenant SaaS platform: one deployment serves many koperasi ("tenants"), each with
its own subdomain, its own members, and its own financial ledger, while sharing the same
application and database instance.

## 2. Goals

Product goals, carried from `docs/claude-integration/PM-INSTRUCTIONS.md`:

| Goal | Target |
|---|---|
| Tenant adoption | 50 koperasi onboarded |
| Customer satisfaction | NPS ≥ 7 |
| Platform availability | 99.5% uptime |
| Dashboard responsiveness | < 3s load |
| API responsiveness | < 500ms (p99) |

Non-goals for the current phase (not committed, not in the schema or codebase — listed so scope
questions have a documented default rather than an implicit one):

- Payment gateway integration (bank transfer / e-wallet settlement)
- Mobile native apps (the frontend is a responsive web app only)
- Government/regulatory e-filing integration (e.g. to Kemenkop UKM systems)
- Multi-currency (Rupiah only; `subscriptionTier` and money fields carry no currency code)

## 3. Users and roles

Roles as implemented in `packages/types/src/user.ts` (`UserRole`) and enforced by
`requireAuth` / `assertUnitAccess` (`apps/backend/src/middleware/auth.ts`):

| Role | Who | Scope |
|---|---|---|
| `super_admin` | SISKOP platform operator | Cross-tenant (Platform Admin module — not yet implemented) |
| `tenant_admin` | Koperasi pengurus (management) | All active units within their tenant |
| `accountant` | Koperasi bendahara (treasurer/bookkeeper) | All active units within their tenant |
| `member` | Koperasi anggota (member) | Only the units they hold a `UnitMembership` in |

A person's login identity (`User`) is distinct from their cooperative membership (`Member`):
staff-only accounts (e.g. `tenant_admin`, `accountant`) need not have a `Member` row.
`Tenant.email` (cooperative contact address) and a user's login email are also distinct — one
person can administer more than one koperasi (see `docs/03-ERD-SISKOP.md`).

## 4. Core product concept: tenant, unit, and "KSU"

Every tenant is a single koperasi with one or more `CooperativeUnit`s. A **koperasi serba usaha
(KSU)** — a cooperative running several lines of business at once — is not a distinct type; it is
a tenant with more than one active unit (`isMultiUnit()` in `packages/types/src/unit.ts`). This is
a deliberate product decision (`CLAUDE.md` rule 2b, ratified in `SETUP-VERIFICATION.md`): it keeps
`if (type === 'KSU')` branching out of member enrollment, savings/loan scoping, SHU distribution,
and reporting. Consolidated (tenant-wide) reporting omits the unit filter; per-unit reporting adds
it — the same query shape serves both a single-unit KSP and a five-unit KSU.

Unit types implemented (`CooperativeType`): `KSP` (simpan pinjam / savings & loan), `KONSUMEN`
(consumer goods), `PRODUSEN` (producer), `JASA` (services), `PEMASARAN` (marketing).

Tenants are addressed by subdomain (`Tenant.slug`, e.g. `demo.localhost:3000`), resolved from the
request's `Host` header, never from user input in the request body — see
`docs/04-System-Architecture-SISKOP.md` §5 for why this is a hard security boundary, not a
convenience feature.

## 5. Modules and current status

Module list per `CLAUDE.md` "Module ownership". Status reflects the actual repository, not the
original scaffolding plan.

| Module | Status | Evidence |
|---|---|---|
| Auth | **Implemented** | `apps/backend/src/modules/auth/` — register (tenant + first unit + admin, one transaction), login (subdomain-resolved), refresh, `me` |
| Tenant provisioning | **Implemented** | `apps/backend/src/modules/tenants/provision.ts` |
| Dashboard | Not started | No route, no page beyond a health-check `HomePage.tsx` |
| Members | **Schema only** | `Member`, `UnitMembership` Prisma models exist; no CRUD routes, no frontend pages; `CreateMemberRequest` / `ListMembersQuery` types are defined in `@siskop/types` but unconsumed |
| Savings | **Schema only** | `SavingsAccount` model (simpanan pokok/wajib/sukarela via `type`); no service layer |
| Loans | **Schema only** | `Loan` model (principal, rate, term, `kolClass` 1–5 kolektibilitas, status); no service layer |
| Transactions (ledger) | **Schema only** | `Transaction` model links to a savings account or a loan; nothing writes to it yet |
| Reports | Not started | No aggregation code; SHU distribution and financial reports are undesigned |
| Config | Not started | No tenant-settings model or routes |
| Platform Admin | Not started | No cross-tenant admin surface; `super_admin` role exists in the type system only |

**Sprint 1 scope** (per `PM-INSTRUCTIONS.md`): Auth, Dashboard, Members. Auth is done; Dashboard
and Members are next.

## 6. Functional requirements (high-level)

Detailed, testable requirements live in `docs/02-System-Requirements-SISKOP.md`. Summary by
module:

- **Auth**: self-service tenant registration (creates tenant + first unit + `tenant_admin` in one
  transaction); subdomain-based login; JWT access/refresh session; `/me` identity check.
- **Dashboard**: at-a-glance tenant summary (member count, savings totals, loan portfolio health,
  recent activity) — scope and exact widgets not yet defined; PM to prioritize for Sprint 1.
- **Members**: create/list/search members, enroll a member into one or more units, member status
  lifecycle (`active` / `inactive` / `suspended`).
- **Savings**: per-member, per-unit savings accounts across three types (simpanan pokok/wajib
  bersifat wajib rutin, simpanan sukarela); balance tracking via the `Transaction` ledger.
- **Loans**: loan issuance (principal, rate, term), repayment tracking, kolektibilitas (KOL)
  classification 1–5 for portfolio risk/regulatory reporting.
- **Reports**: consolidated vs. per-unit financial reports, SHU distribution calculation (basis:
  savings/loan volume for KSP-type units, purchase volume for Konsumen-type units, per the
  `CooperativeUnit` model comment).
- **Config**: tenant-level settings (business rules, SHU formula parameters, fiscal year) — not
  yet designed.
- **Platform Admin**: cross-tenant visibility for `super_admin` (tenant list, activation/
  deactivation, subscription tier) — not yet designed.

## 7. Non-functional requirements

See `docs/02-System-Requirements-SISKOP.md` for the full, testable list. Headlines, carried from
`QA-INSTRUCTIONS.md` and `OPS-INSTRUCTIONS.md`:

- API p99 < 500ms · dashboard load < 3s · PDF export < 10s
- 99.5% uptime · RTO < 1h · RPO < 15min · daily backups with a tested restore
- Multi-tenant data isolation is a release-blocking test category (`QA-INSTRUCTIONS.md`
  "highest-risk areas to test first")
- Money is always `Decimal(18,2)`, never float (`CLAUDE.md` rule 2)

## 8. Subscription model

`Tenant.subscriptionTier` implements three tiers (`starter` | `professional` | `enterprise`,
default `starter`). Feature gating by tier is not yet implemented anywhere in the codebase — the
column exists, but no code branches on it. Pricing and per-tier feature boundaries are undefined
and are a PM decision.

## 9. Open product decisions

Carried from `SETUP-VERIFICATION.md` "Open decision for the Lead Engineer" — these are ratified
technical decisions with product consequences, listed here so PM/QA/Ops don't re-litigate them
without cause:

1. **No `KSU` enum value.** A koperasi serba usaha is derived (`units.length > 1`), not stored.
   Diverges from an earlier internal research doc that modeled `KSU` as a sixth enum member.
2. **"≥1 unit per tenant" is enforced in application code**, not a database constraint (Postgres
   cannot express "at least one child row"). Regression coverage is
   `apps/backend/tests/provision-tenant.test.ts`.
3. **Unit access rides in the JWT** (`unitIds` claim). A staff member's access change takes up to
   15 minutes (`JWT_EXPIRES_IN`) to take effect. Acceptable today; revisit if staff start moving
   between units frequently mid-shift.
4. **Login identifies the tenant by subdomain**, not a "kode koperasi" field in the login form.
   Chosen to match the intended login UX (`demo.localhost`) and to keep tenant selection outside
   anything the client can send in a request body.

## 10. Success metrics and instrumentation gap

The PM targets above (uptime, latency, NPS, onboarded-tenant count) have no instrumentation yet —
there is no metrics/analytics pipeline in the codebase (see
`docs/04-System-Architecture-SISKOP.md` §9, "Observability"). This is a gap to close before Sprint
1 exits, not a documentation oversight to ignore.

## 11. Related documents

- `docs/02-System-Requirements-SISKOP.md` — detailed functional & non-functional requirements
- `docs/03-ERD-SISKOP.md` — entity-relationship diagram
- `docs/04-System-Architecture-SISKOP.md` — system architecture
- `docs/05-DB-Schema-SISKOP.md` — database schema reference
- `docs/claude-integration/PM-INSTRUCTIONS.md` — PM decision authority and targets
- `SETUP-VERIFICATION.md` — what has actually been run and observed in this repo
