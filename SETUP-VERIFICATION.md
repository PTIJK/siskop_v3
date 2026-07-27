# Setup Verification

Run 2026-07-27. Checked boxes were executed and observed, not assumed.
Re-run 2026-07-27 after the `CooperativeUnit` gap was closed (plan Tasks 3, 5, 6, 6b, 9).

## Verified

- [x] `pnpm install` completes (pnpm 9.15.9, Node 24.14.0)
- [x] `pnpm install --frozen-lockfile` completes — lockfile is in sync, as CI requires
- [x] `docker compose ps` shows postgres healthy (`siskop-postgres`, host port **5433**)
- [x] `pnpm --filter @siskop/backend db:migrate` created `prisma/migrations/20260727082242_init`
- [x] `20260727090000_add_cooperative_units` applied — adds `CooperativeUnit`,
      `UnitMembership`, and a non-null `unitId` on `SavingsAccount`, `Loan`, `Transaction`
- [x] All 8 tables exist in `siskop_dev`; `prisma migrate diff` reports no drift
- [x] `siskop_test` created and migrated — integration tests never touch `siskop_dev`
- [x] `pnpm --filter @siskop/backend exec prisma migrate deploy` runs clean
- [x] `pnpm run lint` exits 0 (3 packages)
- [x] `pnpm run typecheck` exits 0 (4 tasks) — `AuthClaims.unitIds` and the Zod
      `claimsSchema` verified in sync here, per plan Task 6 Step 3b
- [x] `pnpm run test` passes — 20 tests, coverage 96.47% lines / 87.5% branches / 100% funcs
- [x] `pnpm run build` exits 0 (3 packages)
- [x] `curl localhost:3001/health` returns the success envelope
- [x] `curl localhost:3000/api/health` returns the success envelope — the Vite proxy
      reaches the backend on the exact path the frontend client requests
- [x] `CLAUDE.md` present at repo root, including rule 2b (units)
- [x] Four agent instruction files in `docs/claude-integration/`

## Not verified (requires a GUI or a push)

- [ ] `code siskop.code-workspace` loads 4 folders — needs an interactive VSCode session
- [ ] F5 → "Backend: dev server" starts under the debugger — needs an interactive session
- [ ] Browser at http://localhost:3000 visually renders status "ok" — the underlying
      request the page makes was verified via curl, but the rendered DOM was not
- [ ] CI green on GitHub Actions — **not pushed**. All five CI steps were reproduced
      locally in order and passed; the workflow itself has never run on a runner.

## Known gaps carried over from the plan

- The team docs referenced by `CLAUDE.md` and the agent instruction files
  (`CLAUDE-PROJECT-SISKOP-SETUP.md`, `ENGINEER-ONBOARDING.md`, `QA-TEST-PLAN.md`,
  `OPERATIONS-DEPLOYMENT.md`, `01-PRD-SISKOP.md`, `02-FSD-SISKOP.md`, `03-ERD-SISKOP.md`,
  `04-System-Architecture-SISKOP.md`, `PM-BRIEFING.md`) are **not in this repo**. The plan
  names them as sources of truth but never creates them, so those references dangle.
- `packages/shared` appears in the plan's file-structure diagram but is never created and
  nothing imports it. Deferred by the plan itself.
- Frontend has no test setup (no Vitest/RTL, no `test` script), so `turbo run test` covers
  the backend only. Playwright e2e is deferred to QA in Week 5.
- No auth login/register endpoints — Sprint 1 work. `src/modules/` now holds `tenants/`
  (provisioning) only.

## Open decision for the Lead Engineer

The plan flags this as theirs to ratify, and it is now implemented rather than merely
proposed:

- `CooperativeType` has **no `KSU` member**. A koperasi serba usaha is a tenant with more
  than one `CooperativeUnit`, derived by `isMultiUnit()`. This diverges from
  `COOPERATIVE-TYPES-RESEARCH.md`, which models `KSU` as a sixth enum value on `Tenant`.
- The "≥1 unit per tenant" invariant is enforced in `provisionTenant()`, not by a database
  constraint — Postgres cannot express "at least one child row". The regression guard is
  the orphan-tenant test in `tests/provision-tenant.test.ts`.
- `unitIds` rides in the JWT, so unit-access changes take up to `JWT_EXPIRES_IN` (15m) to
  take effect. Swap `assertUnitAccess` for a cached per-request lookup if staff move
  between units often; call sites do not change.

## Sprint 1 readiness

- [ ] PM has prioritized Auth / Dashboard / Members backlog
- [ ] Engineer has drafted auth API contract
- [ ] QA has written auth acceptance criteria
- [ ] Ops has staging Compose file and monitoring plan
