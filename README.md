# SISKOP — Sistem Informasi Koperasi Berbasis SaaS

Multi-tenant SaaS for Indonesian cooperative management.

## Quick start (5 minutes)

```bash
git clone <repo> siskop && cd siskop
pnpm install
docker compose up -d                        # PostgreSQL on :5433
cp apps/backend/.env.example apps/backend/.env
pnpm --filter @siskop/backend db:migrate
pnpm run dev                                # backend :3001, frontend :3000
```

Verify: `curl localhost:3001/health` returns `{"success":true,...}`, and
http://localhost:3000 shows the backend status as ok.

> **Postgres runs on host port 5433, not 5432.** Development machines in this project
> already have an unrelated native Postgres service bound to 5432; the compose file maps
> `5433 -> 5432` to avoid silently connecting to the wrong database. CI uses 5432, since
> runners are clean.

## Layout

| Path | What |
|------|------|
| `apps/backend` | Express API, Prisma, PostgreSQL |
| `apps/frontend` | React + Vite + Tailwind |
| `packages/types` | Shared API & domain types |
| `packages/eslint-config` | Shared lint rules |
| `docs/claude-integration` | Per-agent Claude instructions |
| `CLAUDE.md` | Repo context Claude Code loads automatically |

## Commands

`pnpm run dev` · `pnpm run test` · `pnpm run lint` · `pnpm run typecheck` · `pnpm run build`

## Team model

Four agents — PM, Engineer, QA, Ops — with no-consensus convergence. The
highest-authority agent for a given issue decides within 24h. See
`CLAUDE-PROJECT-SISKOP-SETUP.md`.

## VSCode

`code siskop.code-workspace` — loads all packages, recommended extensions, and
debug configs for backend, tests, and the browser.
