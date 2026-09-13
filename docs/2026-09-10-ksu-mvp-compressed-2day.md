# KSU MVP (Toko + KSP) — Compressed 2-Day Plan

> **Status:** Pre-work spike, ahead of the locked Jan 2027 KSU engineering start (SD-001).
> Compressed variant of [`2026-09-10-ksu-mvp-week1.md`](./2026-09-10-ksu-mvp-week1.md) (the 5-day
> plan) for a tighter timebox. Same goal, same non-negotiables, same acceptance checklist —
> this file only compresses the *sequencing*, not the scope.
>
> **Trade-off going in:** the 5-day plan runs a full regression pass at the end of *every* day.
> Compressed to 2 days, that gate only fires twice (end of Day 1, end of Day 2) instead of five
> times — if something regresses on existing KSP/Konsumen tenants, it surfaces later and with a
> larger diff to bisect. Accept this consciously; don't compress further than 2 days without
> adding regression checkpoints back in.

**Goal:** Prove that a KSU tenant (Toko + KSP units) can run on additive-only schema changes,
with zero behavior change to existing single-unit KSP/Konsumen tenants, and produce a correct
consolidated Neraca/SHU/Arus Kas from two units' ledgers.

**Architecture:** `Unit` becomes an optional dimension attached to existing `Loan`/`Saving`
(KSP) and `Product`/`POS Transaction` (Konsumen) records via a nullable `unitId` FK.
KSU status is derived (`tenant.units.length > 1`), never stored as an enum. A new
consolidation service reads existing `JournalEntry`/`JournalLine` data (unmodified) and
groups it by unit for reporting.

**Tech Stack:** Node.js, Express, Prisma, PostgreSQL, Vitest (per `ENGINEER-ONBOARDING.md` conventions)

---

## Non-negotiables (unchanged from the 5-day plan)

1. **No modification to existing KSP/Konsumen endpoint behavior.** Every schema change is
   additive (new nullable columns, new tables). A tenant with no `Unit` records must behave
   identically to today.
2. **No touching `journal.ts` posting logic.** The double-entry engine stays exactly as-is;
   consolidation only *reads* from `JournalEntry`/`JournalLine`, it never changes how they're written.
3. **Feature-flagged.** Multi-unit code paths only activate for tenants explicitly flagged
   `isMultiUnit = true`. All 50 live KSP tenants stay flagged `false`.
4. **Full regression suite runs at the end of Day 1 and Day 2** — the only two checkpoints
   this compression leaves, so neither is skippable.

---

## Day 1 — Schema, unit attachment, and consolidation service

Merges the original plan's Day 1 (schema) + Day 2 (attach units) + Day 3 (consolidation)
into one day. Do them in this order — each step's tests depend on the previous step's models
existing.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_ksu_units/migration.sql` (generated)
- Create: `apps/backend/src/modules/ksu/unit.service.ts`
- Create: `apps/backend/src/modules/ksu/unit.routes.ts`
- Create: `apps/backend/src/modules/ksu/consolidation.service.ts`
- Create: `apps/backend/src/modules/ksu/consolidation.routes.ts`
- Modify: `apps/backend/src/modules/loans/loan.service.ts` (add optional `unitId` param to create)
- Test: `tests/schema/units.test.ts`
- Test: `tests/modules/ksu/unit.service.test.ts`
- Test: `tests/modules/ksu/consolidation.service.test.ts`

**Tasks:**

- [ ] Add `Unit` and `UnitMembership` models to `schema.prisma`; add nullable `unitId` to
      `Loan` and `Saving`; add `isMultiUnit Boolean @default(false)` to `Tenant`.
      (Full model definitions: see 5-day plan, Day 1.)

- [ ] Write + pass: `existing single-unit tenant has zero Unit records and unaffected loans`.

- [ ] Run migration against a local dev DB seeded with existing fixture data.
      Run: `pnpm --filter @siskop/backend db:migrate`
      Expected: migration succeeds, no data loss, existing rows have `unitId = NULL`.

- [ ] Implement `unit.service.ts` — `createUnit()` derives `isMultiUnit = true` once a
      tenant's active unit count reaches 2. Write + pass:
      `creating a unit requires tenant.isMultiUnit or auto-flips it on 2nd unit`.

- [ ] Extend `loan.service.ts` `createLoan()` to accept optional `unitId`, passed through
      unchanged when absent. Run existing `tests/modules/loans/*` — expected 100% pass,
      zero changes to existing test files.

- [ ] Implement `consolidation.service.ts` — reads existing `JournalEntry`/`JournalLine`
      unchanged, groups by unit via `sourceId → unitId` lookup. Write + pass:
      `consolidated neraca sums journal entries across both units` (seeded two-unit tenant:
      1 KSP loan disbursed 5,000,000 + 1 Konsumen sale posting 200,000 revenue → total assets
      5,200,000.00, split correctly by unit).

- [ ] Add route: `GET /api/reports/ksu/consolidated?tenantId=` (auth-guarded, `tenantId` from
      `req.auth.tenantId` only — never from query param, per multi-tenant isolation rule).

- [ ] **Regression checkpoint 1/2** — run full existing suite:
      Run: `pnpm run test`
      Expected: 100% pass, zero modifications needed to any existing test file.

- [ ] Commit: `git commit -m "feat(ksu): unit/consolidation schema, service, and route (day 1 of 2)"`

---

## Day 2 — Member statement, segregation stub, seed data, demo

Merges the original plan's Day 4 (member statement + segregation tracker) + Day 5
(seed data, regression, demo walkthrough).

**Files:**
- Create: `apps/backend/src/modules/ksu/member-statement.service.ts`
- Create: `apps/backend/src/modules/ksu/segregation-tracker.service.ts`
- Create: `prisma/seed-ksu-demo.ts`
- Create: `docs/ksu-mvp-2day-demo.md`
- Test: `tests/modules/ksu/member-statement.test.ts`
- Test: `tests/modules/ksu/segregation-tracker.test.ts`

**Tasks:**

- [ ] Implement `member-statement.service.ts` (aggregate existing SHU distribution logic,
      grouped by unit rather than reimplementing SHU calculation). Write + pass:
      `member statement shows SHU split by unit`.

- [ ] Implement `segregation-tracker.service.ts` with a hardcoded Rp 5B threshold check
      (configurable-per-tenant is post-MVP, not in scope this sprint). Write + pass:
      `flags KSP unit approaching loan volume threshold`.

- [ ] Write `seed-ksu-demo.ts`: one KSU tenant, "Simpan Pinjam" unit (3 members, 2 loans,
      2 savings accounts) + "Toko" unit (5 products, 3 POS transactions), realistic Rupiah amounts.
      Run: `pnpm --filter @siskop/backend db:seed:ksu-demo`

- [ ] **Regression checkpoint 2/2 — the critical stability gate:**
      Run: `pnpm run test`
      Expected: 100% pass, including all pre-existing KSP/Konsumen/accounting tests, with
      zero modifications needed to any existing test file.

- [ ] Manually verify via `GET /api/reports/ksu/consolidated` against the seeded demo tenant
      that Neraca/SHU/Arus Kas match hand-calculated totals from the seed data.

- [ ] Manually verify a pre-existing single-unit KSP tenant (from fixture data) still returns
      identical output on `GET /api/reports/financial` as before this sprint's changes — diff
      the JSON response against a pre-change snapshot.

- [ ] Write `docs/ksu-mvp-2day-demo.md`: 1-page walkthrough (seed command, demo tenant
      credentials, which endpoints to hit, expected output) so CPO/CEO can see it working
      without reading code.

- [ ] Commit: `git commit -m "feat(ksu): member statement, segregation flag, demo seed (day 2 of 2)"`

---

## End-of-sprint acceptance checklist

(Identical to the 5-day plan — compression changes timing, not the bar.)

- [ ] Zero changes to any existing endpoint's response shape for `isMultiUnit = false` tenants
- [ ] Zero changes to `journal.ts` posting logic
- [ ] Full existing test suite passes unmodified
- [ ] Consolidated Neraca/SHU/Arus Kas correctly sums two units' journal data
- [ ] Member statement correctly splits SHU by unit
- [ ] Segregation tracker correctly flags a KSP unit approaching Rp 5B loan volume
- [ ] Demo walkthrough doc lets a non-engineer (CPO/CEO) verify the above without reading code

## If this validates: next steps

Log the spike outcome to `CLAUDE.md` under Technical Decisions (new entry, e.g. `TECH-006`),
and treat Jan 2027 as the *hardening + governance-module + full type-coverage* phase rather
than a from-scratch build — the core schema and consolidation logic will already be proven.
