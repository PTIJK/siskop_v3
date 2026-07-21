# SISKOP — Sistem Informasi Koperasi (SaaS)

## Project Overview
- Multi-tenant SaaS for Indonesian Koperasi Simpan Pinjam (savings & loan cooperatives)
- One subdomain per koperasi: `{slug}.siskop.com` (tenant app), `admin.siskop.com` (platform owner)
- Two cooperative types per tenant: **syariah** (profit-sharing) and **konvensional** (interest-based) — affects savings rates, loan calculation, and report formats
- All cooperative data is tenant-scoped — no data crosses tenant boundaries

## Monorepo Structure
```
apps/
  frontend/          React 18 + Vite + TypeScript + Tailwind + shadcn/ui (tenant & admin UI)
  backend/           Node.js + Express + TypeScript REST API
packages/
  shared/            Shared TypeScript types, constants, formatters (formatRupiah, formatTanggalIndonesia)
prisma/
  schema.prisma      Single schema for all tenants (tenantId on every tenant-scoped model)
  migrations/        All migration files — never edit manually
docs/
  architecture.md    @docs/architecture.md
  api-conventions.md @docs/api-conventions.md
  kol-categories.md  @docs/kol-categories.md
```

## Commands
```bash
# Root
pnpm install                          # install all workspaces
pnpm build                            # build all apps
pnpm test                             # test all workspaces

# Frontend (from apps/frontend/)
pnpm dev                              # Vite dev server
pnpm build                            # production build
pnpm vitest run                       # run tests
pnpm lint                             # eslint

# Backend (from apps/backend/)
pnpm dev                              # ts-node-dev watch
pnpm build                            # tsc
pnpm jest                             # run tests
pnpm lint                             # eslint

# Database (from root)
npx prisma migrate dev --name <desc>  # create + apply migration (dev)
npx prisma migrate deploy             # apply migrations (prod/CI)
npx prisma generate                   # regenerate client after schema change
npx prisma studio                     # GUI browser for DB
npx prisma db seed                    # seed reference data
npx prisma migrate reset              # DESTRUCTIVE: wipe + re-seed (dev only)

# Docker
docker compose up -d postgres         # start PostgreSQL
docker compose down                   # stop all
```

## Critical Architecture Rules

**IMPORTANT: Tenant isolation — every Prisma query on tenant-scoped models (Member, Saving, Loan, SavingTransaction, LoanPayment, Role, User) MUST include `where: { tenantId }`. Never query these models without a tenantId filter.**

**IMPORTANT: Never hard-delete Member, Saving, or Loan records. Use `isActive: false` (soft delete only).**

- Tenant resolution: `req.hostname.split('.')[0]` → slug → DB lookup → `req.tenant`
- Platform admin routes (`/api/admin/*`) skip tenant middleware; require `PLATFORM_ADMIN` role
- JWT: 15m access token + 7d refresh token, both `httpOnly` cookies — never `localStorage`
- Google SSO: OAuth2 infra wired, but email must already exist in DB — no auto-provisioning
- After ANY `schema.prisma` change: `npx prisma migrate dev --name <desc>` then `npx prisma generate`

## ID Formats
- All PKs: `cuid()` via Prisma
- Member ID: `KOP-{TENANTSLUG}-{YYYYMM}-{4-digit-seq}` — generated in `apps/backend/src/lib/id-generator.ts`
- Account number: `ACC-{10-digit-random-numeric}`

## Environment
- Copy `.env.example` → `.env` at root; backend reads from root `.env`
- `PLATFORM_DOMAIN=siskop.com` — used by tenant middleware for subdomain extraction
- Never commit `.env` (gitignored)

## Key Reference Docs
- @docs/api-conventions.md — response envelope, error codes, pagination, currency format
- @docs/kol-categories.md — KOL loan quality rules, OJK categories, recalculation logic
- @docs/architecture.md — system architecture and data flow diagrams
