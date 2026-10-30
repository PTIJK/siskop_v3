# Claude Code kickoff prompt: SISKOP Pricing V2

Paste this into Claude Code from the repo root, after copying `PRICING-V2-IMPLEMENTATION-SPEC.md` and `pricing.seed.json` into `docs/pricing-v2/`.

---

You are the lead backend engineer on SISKOP. Implement Pricing V2 in phases.

Read first, in this order:
1. `CLAUDE.md` (repo rules: tenant isolation, Decimal money, API envelope, TDD, 80% coverage).
2. `docs/pricing-v2/PRICING-V2-IMPLEMENTATION-SPEC.md` (the approved plan and settled decisions).
3. `docs/pricing-v2/pricing.seed.json` (the only source for prices, limits and features; never retype numbers).
4. `prisma/schema.prisma` and the existing `modules/auth`, `modules/admin`, `modules/config` code.

Scope now: Phase 0, then Phase 1, then stop and report.

Phase 0 (no code):
- Compare `pricing.seed.json` against the spec and the existing code. List anything inconsistent, plus every place the old `modules` JSON, `whitelabelEnabled`, `maxSavingConfigs` or the single `accounting` flag is read.
- Note that `requires` links in the seed are inferred, not stated by the owner. List them for confirmation.
- Output a short findings report. Do not change code.

Phase 1 (after I approve the Phase 0 report):
- Write failing tests first (seed integrity: every package's included features satisfy `requires` and parents; price sums match the spec's golden cases).
- Add Prisma migrations per section 4 of the spec. Keep `modules` and `whitelabelEnabled` in place for now (backfill only, no drop).
- Implement `prisma/seed/pricing.ts` loading `pricing.seed.json`.
- Add the migration script for live tenants as a dry run only. It must print a mapping table of old tier to new package for owner approval, and must not write anything.
- Run lint, typecheck and tests. Commit with conventional commits.

Hard rules:
- Do not integrate any payment gateway. Build only the adapter interface, the `manual` adapter and a `gdc` stub that returns "not connected" (Phase 4b, later).
- Do not guess missing inputs: VAT rate, bank transfer text and the tenant mapping are owner inputs. Leave them null and flag them.
- Every tenant-scoped query filters by `tenantId` from the auth context.
- Money is Decimal and returned as strings.
- Do not start Phase 2 until I say so.
