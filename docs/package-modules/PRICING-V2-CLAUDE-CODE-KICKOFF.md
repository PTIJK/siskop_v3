# Claude Code kickoff prompt: SISKOP Pricing V2

Setup (one time): copy `PRICING-V2-IMPLEMENTATION-SPEC.md` and `pricing.seed.json` into `docs/pricing-v2/` in the repo. Then open Claude Code in the repo root and paste everything below the line.

---

You are the lead backend engineer on SISKOP. Implement Pricing V2 in phases. Work only from files in this repo; do not assume any file path or schema detail that you have not opened yourself.

Read first, in this order:
1. `CLAUDE.md` at the repo root (repo rules: tenant isolation, Decimal money, API envelope, TDD, coverage gate). If it is missing, say so and continue with the rules in the spec section 3.
2. `docs/pricing-v2/PRICING-V2-IMPLEMENTATION-SPEC.md` (approved plan and settled decisions).
3. `docs/pricing-v2/pricing.seed.json` (the only source for prices, limits and features; never retype numbers from the spec).
4. Find the Prisma schema, the backend modules for auth (register-tenant), admin (packages), config and members/savings/loans, the billing cron, and the registration and admin frontend pages. Use search, not guesses, and write down the real paths you found.

Known uncertainty to resolve first: older planning docs describe the package as a `SubscriptionPackage` table linked from `Tenant.packageId`, while an early scaffold used a plain `Tenant.subscriptionTier` string. Find out which one this repo actually has and adapt the spec's migrations to it. Report the difference; do not silently pick.

Scope now: Phase 0, then stop.

Phase 0 (read-only, no code changes):
- Compare the spec and the seed against the real code. List every place that reads the old package `modules` JSON, `whitelabelEnabled`, `maxSavingConfigs`, `subscriptionTier`, or the single `accounting` flag.
- List mismatches between the spec's table and field names and the real schema, with your proposed adaptation for each.
- List the `requires` links in `pricing.seed.json`. They are inferred from the matrix, not stated by the product owner, so I need to confirm them.
- Confirm the test runner, lint, typecheck and coverage commands by reading `package.json` and CI config, and run the existing test suite once to record the baseline.
- Output one short findings report with the real file paths. Do not change any file.

After I approve the Phase 0 report I will tell you to start Phase 1 (schema, seed, migration dry run). Do not start Phase 1 or later phases on your own.

Hard rules for every phase:
- Do not integrate any payment gateway. Only the adapter interface, a `manual` adapter and a `gdc` stub that returns "not connected" are in scope (Phase 4b).
- Do not guess missing inputs: VAT rate, bank transfer text and the tenant package mapping are owner inputs. Leave them null and flag them.
- Every tenant-scoped query filters by `tenantId` from the auth context.
- Money is Decimal and returned as strings.
- Write failing tests first. Conventional commits.
