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
   The same rule holds at login, before `req.auth` exists: the tenant is resolved from
   the request's `Host` subdomain (`slugFromHost`), never from the request body — a
   caller must not be able to name which tenant it authenticates against. This is why
   the Vite dev proxy's `changeOrigin` must stay `false`: `true` rewrites `Host` to the
   proxy target and erases the subdomain before the backend ever sees it.
2. **Money is `Decimal`.** Never `Float`/`number` for balances, principal, or amounts.
2b. **Every tenant has ≥1 `CooperativeUnit`.** Financial rows carry a non-null `unitId`.
   `KSU` is not a type — it's `units.length > 1`. Never write `if (type === 'KSU')`.
   Consolidated reporting = omit the unit filter; per-unit = add it.
3. **API envelope.** Every response is `ApiResponse<T>` from `@siskop/types`.
   Errors use the `ErrorCode` enum — no ad-hoc strings.
4. **TDD.** Write the failing test first. Coverage gate is 80% lines (backend).
5. **Types live in `@siskop/types`.** Don't redeclare domain shapes in apps.
6. **No secrets in code.** Config comes from env; `.env` is gitignored.

## Local environment

Postgres runs on host port **5433**, not 5432 — this machine has an unrelated native
Postgres service on 5432. `docker compose up -d postgres` maps 5433 -> 5432; keep
`apps/backend/.env` in sync.

Vite's dev server binds `host: "0.0.0.0"` (`apps/frontend/vite.config.ts`), not
`"localhost"`. `*.localhost` subdomains (`demo.localhost:3000`) can resolve to either
127.0.0.1 or ::1 depending on the client, and letting Node resolve the ambiguous string
`"localhost"` bound only the IPv6 side on this machine, refusing every IPv4 connection.

## Module ownership

Auth · Dashboard · Members · Savings · Loans · Reports · Config · Platform Admin —
Engineer leads all; QA owns acceptance, PM owns scope. See
`docs/claude-integration/` for per-role instructions and the escalation tree below
(the plan's `CLAUDE-PROJECT-SISKOP-SETUP.md` was never created — see
`SETUP-VERIFICATION.md` "Known gaps").

## Decision authority

PM — scope & priority. Engineer — API/schema/tech. QA — release go/no-go.
Ops — infrastructure & deploy. Highest-authority agent decides within 24h.
No consensus required.

## Definition of done

Failing test written → implementation → tests pass → lint clean → typecheck clean →
committed with conventional-commit message.
