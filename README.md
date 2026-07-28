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

Integration tests truncate tables, so they run against their own database rather than
`siskop_dev`. Create it once (`apps/backend/.env.test` already points at it):

```bash
docker exec siskop-postgres psql -U postgres -c "CREATE DATABASE siskop_test"
cd apps/backend && DATABASE_URL="postgresql://postgres:postgres@localhost:5433/siskop_test" \
  pnpm exec prisma migrate deploy
```

Verify: `curl localhost:3001/health` returns `{"success":true,...}`, and
http://localhost:3000 shows the backend status as ok.

### Auth: registering and logging in

Tenants are addressed by subdomain — `demo.localhost:3000` logs into the tenant whose
`slug` is `demo`. `*.localhost` resolves to loopback in every modern browser without a
hosts-file entry.

```bash
curl -X POST http://demo.localhost:3000/api/auth/register -H "Content-Type: application/json" -d '{
  "tenantName": "KSP Demo", "slug": "demo", "cooperativeId": "KOP-DEMO-01",
  "address": "Jl. Merdeka 1", "adminName": "Admin Demo", "adminEmail": "admin@demo.test",
  "adminPhone": "0812000000", "password": "demopassword123",
  "firstUnit": { "type": "KSP", "name": "Simpan Pinjam" }
}'
```

Then open `http://demo.localhost:3000/login` and sign in with `admin@demo.test`.

> **Postgres runs on host port 5433, not 5432.** Development machines in this project
> already have an unrelated native Postgres service bound to 5432; the compose file maps
> `5433 -> 5432` to avoid silently connecting to the wrong database. CI uses 5432, since
> runners are clean.

## Layout

| Path | What |
|------|------|
| `apps/backend` | Express API, Prisma, PostgreSQL |
| `apps/backend/src/modules` | One directory per module (auth, tenants, members, …) |
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
`docs/claude-integration/` for each role's instructions (the plan's
`CLAUDE-PROJECT-SISKOP-SETUP.md` escalation doc was never created —
see `SETUP-VERIFICATION.md` "Known gaps").

## VSCode

`code siskop.code-workspace` — loads all packages, recommended extensions, and
debug configs for backend, tests, and the browser.
