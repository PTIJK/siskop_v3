# KSU MVP (Toko + KSP) — Week 1 Development Plan

> **Status:** Pre-work spike, ahead of the locked Jan 2027 KSU engineering start (SD-001).
> Goal of this week is to de-risk the schema and consolidation logic *before* the Dec 2026
> CPO spec is finalized — not to ship to production. If validated, log the acceleration
> decision to `CLAUDE.md` under Strategic Decisions before Jan.

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

## Non-negotiables for this week

1. **No modification to existing KSP/Konsumen endpoint behavior.** Every schema change is
   additive (new nullable columns, new tables). A tenant with no `Unit` records must behave
   identically to today.
2. **No touching `journal.ts` posting logic.** The double-entry engine stays exactly as-is;
   consolidation only *reads* from `JournalEntry`/`JournalLine`, it never changes how they're written.
3. **Feature-flagged.** Multi-unit code paths only activate for tenants explicitly flagged
   `isMultiUnit = true`. All 50 live KSP tenants stay flagged `false`.
4. **Regression test on existing tenants runs at the end of every day**, not just Day 5.

---

## Day 1 — Schema (additive only)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_ksu_units/migration.sql` (generated)
- Test: `tests/schema/units.test.ts`

**Tasks:**

- [ ] Add new models to `schema.prisma`:

```prisma
model Unit {
  id            String   @id @default(cuid())
  tenantId      String
  name          String              // e.g. "Toko", "Simpan Pinjam"
  unitType      String              // "KONSUMEN" | "KSP" | "PRODUSEN" | "JASA" | "PEMASARAN"
  isActive      Boolean  @default(true)
  createdAt     DateTime @default(now())

  tenant        Tenant   @relation(fields: [tenantId], references: [id])
  memberships   UnitMembership[]

  @@index([tenantId])
}

model UnitMembership {
  id            String   @id @default(cuid())
  tenantId      String
  unitId        String
  memberId      String

  unit          Unit     @relation(fields: [unitId], references: [id])

  @@unique([unitId, memberId])
  @@index([tenantId])
}
```

- [ ] Add nullable `unitId` to existing models (additive, no default change to existing rows):

```prisma
model Loan {
  // ...existing fields unchanged...
  unitId  String?   // NEW — null for all existing single-unit tenants
}

model Saving {
  // ...existing fields unchanged...
  unitId  String?   // NEW
}

// Konsumen module (Product / POSTransaction — confirm exact model names against
// the v2.0 Konsumen schema once it lands; same pattern applies)
```

- [ ] Add `isMultiUnit Boolean @default(false)` to `Tenant`.

- [ ] Write the failing test:

```typescript
// tests/schema/units.test.ts
import { prisma } from '../../src/lib/prisma';

test('existing single-unit tenant has zero Unit records and unaffected loans', async () => {
  const tenant = await prisma.tenant.findFirst({ where: { isMultiUnit: false } });
  const units = await prisma.unit.findMany({ where: { tenantId: tenant.id } });
  expect(units.length).toBe(0);

  const loan = await prisma.loan.findFirst({ where: { tenantId: tenant.id } });
  expect(loan.unitId).toBeNull();
});
```

- [ ] Run migration against a local dev DB seeded with existing fixture data.
      Run: `pnpm --filter @siskop/backend db:migrate`
      Expected: migration succeeds, no data loss, existing rows have `unitId = NULL`.

- [ ] Run test — expected PASS.

- [ ] Commit: `git commit -m "feat(ksu): add Unit/UnitMembership models, nullable unitId on Loan/Saving"`

---

## Day 2 — Attach units to existing modules

**Files:**
- Create: `apps/backend/src/modules/ksu/unit.service.ts`
- Create: `apps/backend/src/modules/ksu/unit.routes.ts`
- Modify: `apps/backend/src/modules/loans/loan.service.ts` (add optional `unitId` param to create)
- Test: `tests/modules/ksu/unit.service.test.ts`

**Tasks:**

- [ ] Write failing test for unit creation:

```typescript
test('creating a unit requires tenant.isMultiUnit or auto-flips it on 2nd unit', async () => {
  const tenant = await createTestTenant({ isMultiUnit: false });
  await createUnit(tenant.id, { name: 'Simpan Pinjam', unitType: 'KSP' });
  const t1 = await prisma.tenant.findUnique({ where: { id: tenant.id } });
  expect(t1.isMultiUnit).toBe(false); // 1 unit is not yet KSU

  await createUnit(tenant.id, { name: 'Toko', unitType: 'KONSUMEN' });
  const t2 = await prisma.tenant.findUnique({ where: { id: tenant.id } });
  expect(t2.isMultiUnit).toBe(true); // 2nd unit derives KSU state
});
```

- [ ] Implement `unit.service.ts`:

```typescript
export async function createUnit(tenantId: string, input: { name: string; unitType: string }) {
  const unit = await prisma.unit.create({
    data: { tenantId, name: input.name, unitType: input.unitType }
  });

  const unitCount = await prisma.unit.count({ where: { tenantId, isActive: true } });
  if (unitCount >= 2) {
    await prisma.tenant.update({ where: { id: tenantId }, data: { isMultiUnit: true } });
  }
  return unit;
}
```

- [ ] Run test — expected PASS.

- [ ] Extend `loan.service.ts` `createLoan()` to accept optional `unitId` and pass through
      unchanged when absent (existing single-unit tenants pass no `unitId`, behavior identical).

- [ ] Regression test: run full existing `tests/modules/loans/*` suite.
      Run: `pnpm run test -- loans`
      Expected: 100% pass, zero changes needed to existing test files.

- [ ] Commit: `git commit -m "feat(ksu): unit creation service with derived isMultiUnit state"`

---

## Day 3 — Consolidation service

**Files:**
- Create: `apps/backend/src/modules/ksu/consolidation.service.ts`
- Create: `apps/backend/src/modules/ksu/consolidation.routes.ts`
- Test: `tests/modules/ksu/consolidation.service.test.ts`

**Tasks:**

- [ ] Write failing test with a seeded two-unit tenant (1 KSP loan disbursed, 1 Konsumen sale posted):

```typescript
test('consolidated neraca sums journal entries across both units', async () => {
  const { tenant, kspUnit, tokoUnit } = await seedKsuTestTenant();
  // kspUnit has one disbursed loan of 5,000,000
  // tokoUnit has one POS sale posting 200,000 revenue

  const consolidated = await getConsolidatedNeraca(tenant.id);
  expect(consolidated.totalAssets.toString()).toBe('5200000.00');
  expect(consolidated.byUnit).toHaveLength(2);
  expect(consolidated.byUnit.find(u => u.unitId === kspUnit.id).assets.toString()).toBe('5000000.00');
  expect(consolidated.byUnit.find(u => u.unitId === tokoUnit.id).assets.toString()).toBe('200000.00');
});
```

- [ ] Implement `consolidation.service.ts` — reads existing `JournalEntry`/`JournalLine`
      unchanged, groups by `sourceId → unitId` lookup:

```typescript
export async function getConsolidatedNeraca(tenantId: string) {
  const units = await prisma.unit.findMany({ where: { tenantId, isActive: true } });

  const byUnit = await Promise.all(units.map(async (unit) => {
    const lines = await prisma.journalLine.findMany({
      where: {
        tenantId,
        journalEntry: {
          OR: [
            { sourceId: { in: await getLoanIdsForUnit(unit.id) } },
            { sourceId: { in: await getSavingIdsForUnit(unit.id) } },
          ]
        }
      },
      include: { account: true }
    });
    const assets = sumByAccountCategory(lines, 'ASET');
    return { unitId: unit.id, unitName: unit.name, assets };
  }));

  const totalAssets = byUnit.reduce((sum, u) => sum.add(u.assets), new Decimal(0));
  return { totalAssets, byUnit };
}
```

- [ ] Run test — expected PASS.

- [ ] Add route: `GET /api/reports/ksu/consolidated?tenantId=` (auth-guarded, `tenantId` from
      `req.auth.tenantId` only — never from query param, per multi-tenant isolation rule).

- [ ] Commit: `git commit -m "feat(ksu): consolidated neraca service reading existing journal data"`

---

## Day 4 — Member per-unit statement + segregation tracker stub

**Files:**
- Create: `apps/backend/src/modules/ksu/member-statement.service.ts`
- Create: `apps/backend/src/modules/ksu/segregation-tracker.service.ts`
- Test: `tests/modules/ksu/member-statement.test.ts`
- Test: `tests/modules/ksu/segregation-tracker.test.ts`

**Tasks:**

- [ ] Write failing test for member per-unit SHU breakdown:

```typescript
test('member statement shows SHU split by unit', async () => {
  const { member, kspUnit, tokoUnit } = await seedKsuTestTenantWithSHU();
  const statement = await getMemberUnitStatement(member.id);
  expect(statement.units).toEqual([
    { unitId: kspUnit.id, unitName: 'Simpan Pinjam', shu: '150000.00' },
    { unitId: tokoUnit.id, unitName: 'Toko', shu: '80000.00' },
  ]);
});
```

- [ ] Implement `member-statement.service.ts` (aggregate existing SHU distribution logic,
      grouped by unit rather than reimplementing SHU calculation).

- [ ] Run test — expected PASS.

- [ ] Write stub test for segregation tracker (KSP unit only — Toko doesn't need this check):

```typescript
test('flags KSP unit approaching loan volume threshold', async () => {
  const { tenant, kspUnit } = await seedKsuTestTenant({ kspLoanVolume: 4_800_000_000 });
  const flag = await checkUnitSegregation(kspUnit.id);
  expect(flag.status).toBe('APPROACHING_THRESHOLD');
  expect(flag.thresholdRp).toBe(5_000_000_000);
});
```

- [ ] Implement basic threshold check (hardcoded Rp 5B threshold for now — configurable
      per-tenant is a post-MVP task, not this week's scope).

- [ ] Run test — expected PASS.

- [ ] Commit: `git commit -m "feat(ksu): per-unit member SHU statement and USP threshold flag"`

---

## Day 5 — Seed data, full regression, demo walkthrough

**Files:**
- Create: `prisma/seed-ksu-demo.ts`
- Create: `docs/ksu-mvp-week1-demo.md`

**Tasks:**

- [ ] Write `seed-ksu-demo.ts`: one KSU tenant, "Simpan Pinjam" unit (3 members, 2 loans,
      2 savings accounts) + "Toko" unit (5 products, 3 POS transactions), realistic Rupiah amounts.

- [ ] Run seed: `pnpm --filter @siskop/backend db:seed:ksu-demo`

- [ ] **Full regression suite against all existing modules** — this is the critical stability gate:
      Run: `pnpm run test`
      Expected: 100% pass, including all pre-existing KSP/Konsumen/accounting tests, with
      zero modifications needed to any existing test file.

- [ ] Manually verify via `GET /api/reports/ksu/consolidated` against the seeded demo tenant
      that Neraca/SHU/Arus Kas match hand-calculated totals from the seed data.

- [ ] Manually verify a pre-existing single-unit KSP tenant (from fixture data) still returns
      identical output on `GET /api/reports/financial` as before this week's changes — diff
      the JSON response against a pre-change snapshot.

- [ ] Write `docs/ksu-mvp-week1-demo.md`: 1-page walkthrough (seed command, demo tenant
      credentials, which endpoints to hit, expected output) so CPO/CEO can see it working
      without reading code.

- [ ] Commit: `git commit -m "chore(ksu): demo seed data and week 1 spike walkthrough"`

---

## End-of-week acceptance checklist

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
