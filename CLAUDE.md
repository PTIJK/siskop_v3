# SISKOP — Claude Context

SaaS cooperative management system (Sistem Informasi Koperasi) for Indonesian koperasi.

## Commands

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Dev (all) | `pnpm run dev` |
| Test | `pnpm run test` |
| Lint | `pnpm run lint` |
| Typecheck | `pnpm run typecheck` |
| Migrate DB | `pnpm --filter @siskop/backend db:migrate` |

## Non-negotiable rules

1. **Multi-tenant isolation.** Every Prisma query touching tenant data MUST filter by
   `tenantId` taken from `req.auth.tenantId`. Never from the request body or a URL param.
2. **Money is `Decimal`.** Never `Float`/`number` for balances, principal, or amounts.
3. **API envelope.** Every response is `ApiResponse<T>` from `@siskop/types`.
   Errors use the `ErrorCode` enum — no ad-hoc strings.
4. **TDD.** Write the failing test first. Coverage gate is 80% lines (backend).
5. **Types live in `@siskop/types`.** Don't redeclare domain shapes in apps.
6. **No secrets in code.** Config comes from env; `.env` is gitignored.

## Local environment

Postgres runs on host port **5433**, not 5432 — this machine has an unrelated native
Postgres service on 5432. `docker compose up -d postgres` maps 5433 -> 5432; keep
`apps/backend/.env` in sync.

## Module ownership

Auth · Dashboard · Members · Savings · Loans · Reports · Config · Platform Admin —
Engineer leads all; QA owns acceptance, PM owns scope. See
`CLAUDE-PROJECT-SISKOP-SETUP.md` for the escalation tree.

## Decision authority

PM — scope & priority. Engineer — API/schema/tech. QA — release go/no-go.
Ops — infrastructure & deploy. Highest-authority agent decides within 24h.
No consensus required.

## Definition of done

Failing test written → implementation → tests pass → lint clean → typecheck clean →
committed with conventional-commit message.
