# 05 — Database Schema: SISKOP

Status: generated directly from `apps/backend/prisma/schema.prisma` and its applied migrations, as
of 2026-07-28. Source of truth is the Prisma schema file — if this document and the schema
disagree, the schema is right and this document is stale.

Database: PostgreSQL 15. Local dev connects on host port **5433** (mapped to the container's
5432 — see `docker-compose.yml`); CI uses the standard 5432 on a clean runner.

## 1. Migration history

| Migration | Adds |
|---|---|
| `20260727082242_init` | `Tenant`, `User`, `Member`, `SavingsAccount`, `Loan`, `Transaction` |
| `20260727090000_add_cooperative_units` | `CooperativeUnit`, `UnitMembership`, non-null `unitId` on `SavingsAccount`, `Loan`, `Transaction` |
| `20260727093000_add_tenant_slug` | `Tenant.slug` (unique, the login subdomain) |

Run migrations with `pnpm --filter @siskop/backend db:migrate` (dev, creates a migration) or
`prisma migrate deploy` (CI/prod, applies existing migrations only).

## 2. Conventions used throughout

- **Primary keys**: `String @id @default(cuid())` on every table — collision-resistant IDs
  generated in application code, not sequential integers.
- **Money**: `Decimal` with explicit precision — `@db.Decimal(18, 2)` for amounts/balances,
  `@db.Decimal(6, 4)` for interest rates. Never `Float`/`Int` (`CLAUDE.md` rule 2).
  `Decimal(18,2)` supports values up to 9,999,999,999,999,999.99 — far beyond any realistic
  koperasi balance, chosen for headroom rather than tight sizing.
- **Timestamps**: `createdAt DateTime @default(now())` on every table; `updatedAt DateTime
  @updatedAt` on every table except the append-only `Transaction`, which has no `updatedAt`
  because ledger entries are never mutated after creation.
- **Tenant scoping**: every table except `UnitMembership` carries a direct `tenantId` column
  (even where it could be derived through a join, as on `Transaction` — see §2 note below). This
  is deliberate denormalization so the tenant-isolation predicate is always a single indexed
  column, never a multi-hop join.
- **Enums modeled as `String`, not Postgres `enum`**: `CooperativeUnit.type`,
  `SavingsAccount.type`, `Loan.status`, `Transaction.direction`, `User.role`, `Member.status` are
  all plain `String` columns, validated at the application boundary (Zod) rather than by a
  database `CHECK`/`ENUM` constraint. This trades DB-level enforcement for the flexibility to add
  a new value without a migration; the tradeoff is not documented as deliberate in the schema
  comments, so treat it as inherited rather than re-justify it without checking with Engineering
  first.
- **Cascade deletes**: `onDelete: Cascade` from `Tenant` down through nearly every child table, and
  from `CooperativeUnit`/`Member` down to their children — deleting a tenant deletes everything
  under it. `SavingsAccount.unit`, `Loan.unit`, `Transaction.unit`, `Transaction.savingsAccount`,
  `Transaction.loan` have **no** cascade — deleting a `CooperativeUnit` while savings/loan/
  transaction rows reference it, or deleting a `SavingsAccount`/`Loan` while transactions
  reference it, is a foreign-key violation, not a silent cascade. This is almost certainly
  intentional (a unit or account with financial history shouldn't disappear quietly) but is not
  explicitly commented in the schema — flag it if a future migration seems like it needs one.

## 3. Tables

### 3.1 `Tenant`

The cooperative (koperasi) itself — the root of tenant isolation.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `name` | String | | Display name |
| `slug` | String | **Unique** | Login subdomain, e.g. `demo` → `demo.localhost:3000`. Hostname-label format only (`[a-z0-9](?:[a-z0-9-]*[a-z0-9])?`), enforced by `slugSchema` in application code |
| `cooperativeId` | String | **Unique** | Official registry number — not hostname-safe, kept separate from `slug` for that reason |
| `email` | String | **Unique** | Cooperative's official contact address — globally unique, distinct from any `User.email` (which is unique only per-tenant) |
| `phone` | String | | |
| `address` | String | | |
| `subscriptionTier` | String | default `"starter"` | `starter` \| `professional` \| `enterprise` in the type layer; no DB constraint, no feature-gating code yet |
| `isActive` | Boolean | default `true` | An inactive tenant's users cannot log in (`login()` checks `tenant.isActive`) |
| `createdAt` | DateTime | default `now()` | |
| `updatedAt` | DateTime | `@updatedAt` | |

Indexes: `@@index([isActive])`.

### 3.2 `CooperativeUnit`

A tenant's business line. `type` + count together define whether a tenant is single-purpose or a
koperasi serba usaha (KSU) — see `docs/01-PRD-SISKOP.md` §4.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `type` | String | | `KSP` \| `KONSUMEN` \| `PRODUSEN` \| `JASA` \| `PEMASARAN` (app-validated, `CooperativeType` enum in `@siskop/types`) |
| `name` | String | | |
| `isActive` | Boolean | default `true` | Inactive units are excluded from `isMultiUnit()` and from a staff user's auto-granted `unitIds` |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@index([tenantId, isActive])`, `@@index([tenantId, type])`.

Every tenant has **at least one** row here at all times. Postgres cannot express "at least one
child row" as a constraint, so this invariant is enforced in application code
(`provisionTenant()` / `registerTenant()`, both create the tenant and its first unit in one
`$transaction`) — see `docs/04-System-Architecture-SISKOP.md` §11.

### 3.3 `UnitMembership`

Join table: which units a member actually participates in.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `memberId` | String | FK → `Member.id`, `onDelete: Cascade` | |
| `unitId` | String | FK → `CooperativeUnit.id`, `onDelete: Cascade` | |
| `joinedAt` | DateTime | default `now()` | |

Indexes: `@@unique([memberId, unitId])` (prevents duplicate joins), `@@index([unitId])`.

No `tenantId` column — tenant is always reachable through `memberId`/`unitId`, and this table is
never queried standalone across tenants.

### 3.4 `User`

A login identity. Distinct from `Member` — a person's cooperative membership.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `email` | String | Unique **per tenant** (`@@unique([tenantId, email])`) | Not globally unique — the same email can administer two different koperasi as two different `User` rows |
| `phone` | String | | |
| `name` | String | | |
| `passwordHash` | String | | bcrypt, 10 rounds |
| `role` | String | default `"member"` | `super_admin` \| `tenant_admin` \| `accountant` \| `member` (`UserRole` in `@siskop/types`) |
| `isActive` | Boolean | default `true` | Inactive users are rejected at login and at refresh |
| `lastLoginAt` | DateTime? | nullable | Set on successful login |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@index([tenantId])`, plus the implicit unique index from `@@unique([tenantId, email])`.

### 3.5 `Member`

A koperasi member's identity — separate from unit participation (`UnitMembership`) and separate
from their login (`User`).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `userId` | String | FK → `User.id`, **unique**, `onDelete: Cascade` | 1:1 with `User` — not every `User` has a `Member` (staff-only accounts don't) |
| `membershipId` | String | Unique **per tenant** (`@@unique([tenantId, membershipId])`) | The member's koperasi membership number |
| `status` | String | default `"active"` | `active` \| `inactive` \| `suspended` (`MemberStatus`) |
| `joinDate` | DateTime | default `now()` | |
| `phone` | String | | |
| `address` | String | | |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@index([tenantId, status])`, plus the implicit unique indexes.

Deliberately carries **no `unitId`**: which units a member participates in is `UnitMembership`,
not a column here — see the schema comment and `docs/03-ERD-SISKOP.md` §2.

### 3.6 `SavingsAccount`

A member's savings balance, scoped to one unit and one savings type.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `unitId` | String | FK → `CooperativeUnit.id` (no cascade) | |
| `memberId` | String | FK → `Member.id`, `onDelete: Cascade` | |
| `type` | String | | `simpanan_pokok` (mandatory initial) \| `simpanan_wajib` (mandatory recurring) \| `simpanan_sukarela` (voluntary) |
| `balance` | Decimal(18,2) | default `0` | Nothing currently writes to this column — no deposit/withdrawal service exists yet |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@unique([unitId, memberId, type])` — one account per type per unit per member;
`@@index([tenantId, unitId])`.

### 3.7 `Loan`

A member's loan, scoped to one unit.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | |
| `unitId` | String | FK → `CooperativeUnit.id` (no cascade) | |
| `memberId` | String | FK → `Member.id`, `onDelete: Cascade` | |
| `principal` | Decimal(18,2) | required | |
| `rate` | Decimal(6,4) | required | Interest rate — 4 decimal places supports e.g. `0.0175` (1.75%) |
| `termMonths` | Int | required | |
| `status` | String | default `"active"` | `active` \| `paid` \| `defaulted` |
| `kolClass` | Int | default `1` | Kolektibilitas classification, 1–5 (Indonesian portfolio-risk convention). No DB `CHECK` constraining it to 1–5 — application-validated only, if at all (no service writes this yet) |
| `issuedAt` | DateTime | default `now()` | |
| `dueAt` | DateTime | required | |
| `paidAt` | DateTime? | nullable | |
| `createdAt` / `updatedAt` | DateTime | | |

Indexes: `@@index([tenantId, unitId, status])`, `@@index([tenantId, kolClass])` (the latter
anticipates portfolio-risk reporting queries grouped by KOL class).

No `RepaymentSchedule`/installment table exists — a `Loan` row currently has no per-installment
breakdown (see `docs/03-ERD-SISKOP.md` §4).

### 3.8 `Transaction`

The ledger. Every movement against a `SavingsAccount` or a `Loan` — or, in principle, neither —
is one row here.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | String | PK, cuid | |
| `tenantId` | String | FK → `Tenant.id`, `onDelete: Cascade` | Denormalized alongside `unitId` on purpose — see below |
| `unitId` | String | FK → `CooperativeUnit.id` (no cascade) | |
| `savingsAccountId` | String? | FK → `SavingsAccount.id` (no cascade), nullable | |
| `loanId` | String? | FK → `Loan.id` (no cascade), nullable | |
| `direction` | String | | `debit` \| `credit` |
| `amount` | Decimal(18,2) | required | |
| `description` | String | required | |
| `referenceNo` | String? | nullable | |
| `createdAt` | DateTime | default `now()` | No `updatedAt` — ledger rows are append-only |

Indexes: `@@index([tenantId, unitId, createdAt])` (time-ordered per-tenant/unit queries — the
expected access pattern for statements/reports), `@@index([savingsAccountId])`,
`@@index([loanId])`.

> **Why `tenantId` is repeated here** (schema comment, preserved verbatim in intent): keeping the
> isolation predicate on a single column every query already filters means tenant isolation never
> depends on a join being written correctly. A query that filters `Transaction` by `tenantId`
> directly is safe even if a future code change gets the `savingsAccount`/`loan` join wrong.

No row currently gets written to this table by any service — the ledger exists as a target for
Savings/Loans module writes that haven't been built yet.

## 4. Full-schema entity list

| Table | Purpose | Status |
|---|---|---|
| `Tenant` | Cooperative / SaaS tenant | Fully wired (Auth module) |
| `CooperativeUnit` | Business line within a tenant | Fully wired (Auth module, provisioning) |
| `UnitMembership` | Member ↔ unit join | Created at nothing yet — no route manages it post-registration |
| `User` | Login identity | Fully wired (Auth module) |
| `Member` | Koperasi membership identity | Schema only — no CRUD |
| `SavingsAccount` | Per-unit, per-type savings balance | Schema only — no service |
| `Loan` | Per-unit loan record | Schema only — no service |
| `Transaction` | Append-only ledger | Schema only — nothing writes to it |

## 5. Configuration

Backend reads these environment variables (`apps/backend/.env.example`):

| Variable | Purpose | Dev default |
|---|---|---|
| `DATABASE_URL` | Postgres connection string | `postgresql://postgres:postgres@localhost:5433/siskop_dev` |
| `JWT_SECRET` | Access token signing key | *(must be set — no fallback)* |
| `JWT_REFRESH_SECRET` | Refresh token signing key | *(must be set — no fallback)* |
| `JWT_EXPIRES_IN` | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | Refresh token lifetime | `7d` (code default, not in `.env.example`) |
| `NODE_ENV` | | `development` |
| `PORT` | Backend listen port | `3001` |
| `CORS_ORIGIN` | Allowed origin(s), comma-separated | `http://localhost:3000` |
| `LOG_LEVEL` | | `debug` |

`apps/backend/.env.test` points `DATABASE_URL` at `siskop_test`, a separate database created
manually (`CREATE DATABASE siskop_test` + `prisma migrate deploy`) so integration tests — which
truncate tables between runs — never touch `siskop_dev`.

## 6. Related documents

- `docs/03-ERD-SISKOP.md` — visual entity-relationship diagram and cardinality summary
- `docs/04-System-Architecture-SISKOP.md` §7 — how this schema is used at the query layer
- `docs/02-System-Requirements-SISKOP.md` — functional requirements each table supports
- `apps/backend/prisma/schema.prisma` — source of truth
