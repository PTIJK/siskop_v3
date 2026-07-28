# Setup Verification

Run 2026-07-27. Checked boxes were executed and observed, not assumed.
Re-run 2026-07-27 after the `CooperativeUnit` gap was closed (plan Tasks 3, 5, 6, 6b, 9).
Re-run again 2026-07-27 after subdomain login/registration (Sprint 1 auth) was added.
Re-run again 2026-07-27 after the Vite dev-server host-binding fix (93e0f1b).

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
- [x] `pnpm run test` passes — 57 tests, coverage 96.85% lines / 83.48% branches / 100% funcs
- [x] `POST /api/auth/register` creates tenant + first unit + tenant_admin user in one
      transaction; `POST /api/auth/login` resolves the tenant from the `Host` subdomain
      (never the body) and rejects a wrong password / unknown email with the same message
- [x] `GET /api/auth/me` and `POST /api/auth/refresh` round-trip a session
- [x] `pnpm run build` exits 0 (3 packages)
- [x] `curl localhost:3001/health` returns the success envelope
- [x] `curl localhost:3000/api/health` returns the success envelope — the Vite proxy
      reaches the backend on the exact path the frontend client requests
- [x] `CLAUDE.md` present at repo root, including rule 2b (units)
- [x] Four agent instruction files in `docs/claude-integration/`
- [x] Browser at http://localhost:3000 renders status "ok" — rendered in headless
      Chrome (`--dump-dom` + `--screenshot`), not just curled. The React Query fetch
      resolves, `apiFetch` unwraps the envelope, Tailwind styles apply, and the date
      formats under the `id-ID` locale. Note this machine has no `chromium-cli`;
      drive it with `"/c/Program Files/Google/Chrome/Application/chrome.exe"
      --headless=new --virtual-time-budget=8000`.
- [x] `http://demo.localhost:3000/login` renders, driven end-to-end via chrome-remote-
      interface (real form fill + submit, not a fetch): a registered admin logs in,
      lands on `/`, and sees their name/role — proving the Vite proxy passes the `Host`
      header through unrewritten (`changeOrigin: false`). Wrong password and the
      no-subdomain case (`localhost:3000/login`) both render their intended message.
      Demo tenant deleted from `siskop_dev` afterward; `siskop_dev` is empty again.
- [x] `apps/frontend/vite.config.ts` binds `host: "0.0.0.0"` instead of `"localhost"` —
      on this machine `"localhost"` resolved ambiguously and Vite bound IPv6-only,
      so `curl http://127.0.0.1:3000` returned connection-refused while `http://[::1]:3000`
      returned 200. Reproduced pre-fix, then re-verified post-fix that both
      `curl -4 http://127.0.0.1:3000` and the full `demo.localhost:3000/login` flow
      succeed through a fresh, uncached headless-Chrome profile.

## Not verified (requires a GUI or CI credentials)

- [ ] `code siskop.code-workspace` loads 4 folders — needs an interactive VSCode session
- [ ] F5 → "Backend: dev server" starts under the debugger — needs an interactive session
- [ ] CI green on GitHub Actions — `main` was pushed (`25d4c70..4e8ead9`), so the
      workflow should have run, but the result is unread: `gh` is not installed on this
      machine and the repo is private, so the API returns 404 unauthenticated. All CI
      steps were reproduced locally in order and passed. Check the Actions tab.

## Known gaps carried over from the plan

- The team docs referenced by `CLAUDE.md` and the agent instruction files
  (`CLAUDE-PROJECT-SISKOP-SETUP.md`, `ENGINEER-ONBOARDING.md`, `QA-TEST-PLAN.md`,
  `OPERATIONS-DEPLOYMENT.md`, `01-PRD-SISKOP.md`, `02-FSD-SISKOP.md`, `03-ERD-SISKOP.md`,
  `04-System-Architecture-SISKOP.md`, `PM-BRIEFING.md`) are **not in this repo**. The plan
  names them as sources of truth but never creates them, so those references dangle.
- `packages/shared` appears in the plan's file-structure diagram but is never created and
  nothing imports it. Deferred by the plan itself.
- Frontend has no test setup (no Vitest/RTL, no `test` script), so `turbo run test` covers
  the backend only; the login flow above was verified by driving a real browser, not by
  an automated frontend test. Playwright e2e is deferred to QA in Week 5.
- `src/modules/` now holds `tenants/` (provisioning) and `auth/` (register, login,
  refresh, `me`, the `Host`→slug resolver). No password-reset or email-verification flow.

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
- Login identifies the tenant by subdomain (`Tenant.slug`, new column), not by a field in
  the request body — chosen over an explicit "kode koperasi" input to match the login
  experience the user expected (`demo.localhost`) and to keep the tenant boundary out of
  reach of anything the client sends. `Tenant.email` (cooperative contact address, globally
  unique) is now distinct from a user's login email (unique only within the tenant), so one
  person can administer more than one koperasi.

## Sprint 1 readiness

- [ ] PM has prioritized Auth / Dashboard / Members backlog
- [ ] Engineer has drafted auth API contract
- [ ] QA has written auth acceptance criteria
- [ ] Ops has staging Compose file and monitoring plan
