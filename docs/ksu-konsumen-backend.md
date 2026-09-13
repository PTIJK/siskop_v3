# KSU Konsumen (Toko/POS) — Backend Implementation Plan

> **Status:** Follow-up to the KSU Week 1 spike (`feature/ksu-mvp-week1-spike`, 6 commits,
> not yet merged to main — see [`2026-09-10-ksu-mvp-week1.md`](./2026-09-10-ksu-mvp-week1.md)).
> That spike's own demo doc (`docs/ksu-mvp-week1-demo.md`) names "no Toko/POS module" as an
> explicit gap. This plan closes it. **Backend only** — no frontend UI is in scope here.

**Goal:** A `KONSUMEN`-type `CooperativeUnit` can sell products at the counter (POS), with
stock tracked per unit and every sale posting a correct, balanced double-entry journal —
without touching the KSP posting logic (`postSavingTransaction`/`postLoanDisbursement`/
`postLoanPayment` in `journal.ts` stay byte-for-byte unchanged) or any existing endpoint.

**Grounded in the current schema, not a hypothetical one** — as of this doc, `apps/backend/prisma/schema.prisma`
already has `CooperativeUnit` (type `KONSUMEN` is a valid `type` string today) with **required**
`unitId` on `Saving`/`Loan` (not nullable — the earlier week-1 plan assumed nullable/additive
`unitId`, but the real model was already built that way). `Product`/`POSSale` follow the same
required-`unitId` convention: no product or sale can exist without a unit, same as no loan can.

---

## Non-negotiables

1. **`journal.ts`'s three existing exported functions do not change.** This plan *adds* a
   fourth — `postPosSale()` — and *extends* the type unions `createJournalEntry`/
   `buildComponentLines` accept (`sourceType`, `transactionKind`) to include the new POS
   literals. Nothing about how a `SAVING_TRANSACTION` or `LOAN_PAYMENT`/`LOAN_DISBURSEMENT`
   entry is built changes.
2. **`tenantId` always from `req.auth.tenantId`.** Every Konsumen route, same as every other
   module — never from body or param.
3. **Money is `Decimal`, never `number`/`Float`**, for `Product.price`, `Product.cost`,
   `POSSale.total`, `POSSaleLine.subtotal`. (Note: `journal.ts`'s own `JournalLineInput`
   currently types `debit`/`credit` as `number` — that's pre-existing and out of scope to fix
   here; `postPosSale()` still passes it `Decimal.toNumber()` values the same way the other
   three functions already do, so this plan doesn't make that inconsistency worse or better.)
4. **Stock decrements and the journal entry commit atomically.** A sale that fails to post
   its journal entry must not leave stock decremented — both happen inside one Prisma
   `$transaction`.
5. **Regression suite runs at the end of every day**, same bar as the KSP spike.

---

## Day 1 — Schema (additive) + Product CRUD

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/<timestamp>_add_konsumen_pos/migration.sql` (generated)
- Create: `apps/backend/src/modules/konsumen/product.schema.ts`
- Create: `apps/backend/src/modules/konsumen/product.service.ts`
- Create: `apps/backend/src/modules/konsumen/product.routes.ts`
- Test: `apps/backend/tests/konsumen-product.test.ts`

**Tasks:**

- [ ] Add models, mirroring the `SavingConfig`/`Saving` and `LoanConfig`/`Loan` pattern
      (required `unitId`, `tenantId`, `Decimal` money, standard index set):

```prisma
model Product {
  id        String          @id @default(cuid())
  tenantId  String
  tenant    Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  unitId    String
  unit      CooperativeUnit @relation(fields: [unitId], references: [id])
  sku       String
  name      String
  price     Decimal         @db.Decimal(15, 2)
  cost      Decimal         @db.Decimal(15, 2)
  stockQty  Int             @default(0)
  isActive  Boolean         @default(true)
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  saleLines POSSaleLine[]

  @@unique([tenantId, unitId, sku])
  @@index([tenantId, unitId])
}

model POSSale {
  id         String          @id @default(cuid())
  tenantId   String
  tenant     Tenant          @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  unitId     String
  unit       CooperativeUnit @relation(fields: [unitId], references: [id])
  memberId   String?         // nullable — Toko serves walk-in non-members too, unlike Saving/Loan
  member     Member?         @relation(fields: [memberId], references: [id])
  totalPrice Decimal         @db.Decimal(15, 2)
  totalCost  Decimal         @db.Decimal(15, 2)
  soldAt     DateTime        @default(now())
  createdBy  String
  createdByUser User         @relation(fields: [createdBy], references: [id])
  createdAt  DateTime        @default(now())

  lines POSSaleLine[]

  @@index([tenantId, unitId])
  @@index([memberId])
}

model POSSaleLine {
  id        String   @id @default(cuid())
  saleId    String
  sale      POSSale  @relation(fields: [saleId], references: [id], onDelete: Cascade)
  productId String
  product   Product  @relation(fields: [productId], references: [id])
  qty       Int
  unitPrice Decimal  @db.Decimal(15, 2)
  unitCost  Decimal  @db.Decimal(15, 2)
  subtotal  Decimal  @db.Decimal(15, 2)

  @@index([saleId])
  @@index([productId])
}
```

  Add the back-relations `products POSSaleLine[]`... `saleLines`, `posSales` etc. to
  `CooperativeUnit`, `Tenant`, `Member`, `User` as Prisma requires for each new `@relation`.

- [ ] Write + pass the baseline lock test (same shape as the KSP spike's Day 1):

```typescript
// tests/konsumen-product.test.ts
test('a tenant with no KONSUMEN unit has zero products and the schema does not force one', async () => {
  const tenant = await createTestTenant(); // single KSP unit, no KONSUMEN unit
  const products = await prisma.product.findMany({ where: { tenantId: tenant.id } });
  expect(products.length).toBe(0);
});

test('creating a product requires an existing KONSUMEN-type unit', async () => {
  const { tenant, kspUnit } = await seedSingleUnitTenant();
  await expect(createProduct(tenant.id, kspUnit.id, { sku: 'X', name: 'X', price: 1000, cost: 700 }))
    .rejects.toThrow(); // unit exists but is type KSP, not KONSUMEN
});
```

- [ ] Implement `product.service.ts`: `createProduct()` validates `unit.type === 'KONSUMEN'`
      before insert (mirrors how loan/saving services already validate their config's type
      against the unit, if that check exists — confirm against `loans/service.ts` and match
      its exact validation style rather than inventing a new one).

- [ ] Run migration: `pnpm --filter @siskop/backend db:migrate`. Expected: no data loss,
      no existing table touched except the new back-relation FK columns (nullable-safe, no
      rows exist in the new tables yet so no backfill needed).

- [ ] Regression checkpoint: `pnpm run test` — 100% pass, zero existing test files touched.

- [ ] Commit: `git commit -m "feat(konsumen): add Product/POSSale/POSSaleLine models and product CRUD"`

---

## Day 2 — Sale posting: stock + double-entry journal

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (enum extensions only)
- Modify: `apps/backend/src/lib/journal.ts` (add `postPosSale`, extend the two type unions)
- Modify: `apps/backend/src/modules/config/schema.ts` (extend `transactionKind` zod enum)
- Create: `apps/backend/src/modules/konsumen/sale.schema.ts`
- Create: `apps/backend/src/modules/konsumen/sale.service.ts`
- Test: `apps/backend/tests/konsumen-sale.test.ts`

**Tasks:**

- [ ] Extend Prisma enums (additive — new values only, nothing removed or renamed):

```prisma
enum MappingTransactionKind {
  DEPOSIT
  WITHDRAWAL
  DISBURSEMENT
  PAYMENT_PRINCIPAL
  PAYMENT_INTEREST
  PAYMENT_PENALTY
  SALE_REVENUE   // NEW
  SALE_COGS      // NEW
}

enum JournalSourceType {
  SAVING_TRANSACTION
  LOAN_PAYMENT
  LOAN_DISBURSEMENT
  POS_SALE   // NEW
  MANUAL
}
```

  A POS sale posts under `sourceType: SYSTEM, sourceId: null` in `AccountMapping` — one
  tenant-wide Penjualan/HPP mapping, not one per product — reusing the `SYSTEM` source type
  that already exists in the enum today but has no caller yet. This avoids adding a
  `ProductConfig` model just to hang a mapping off of.

- [ ] Extend `config/schema.ts`'s `transactionKind` zod enum with `SALE_REVENUE`/`SALE_COGS`
      so the existing (already-generic) account-mapping admin UI can wire them up — this is
      the only change needed there; `sourceType` already includes `SYSTEM`.

- [ ] Write the failing journal test first:

```typescript
// tests/konsumen-sale.test.ts
test('a POS sale posts a balanced 4-line journal entry (revenue + COGS pairs)', async () => {
  const { tenant, tokoUnit, product } = await seedKonsumenTestTenant({ price: 15000, cost: 9000 });
  await seedSystemMapping(tenant.id, 'SALE_REVENUE', 'KAS', 'PENJUALAN');
  await seedSystemMapping(tenant.id, 'SALE_COGS', 'HPP', 'PERSEDIAAN');

  const sale = await createSale(tenant.id, tokoUnit.id, {
    lines: [{ productId: product.id, qty: 3 }],
    createdBy: testUser.id
  });

  const lines = await prisma.journalLine.findMany({ where: { journalEntry: { sourceId: sale.id } } });
  expect(lines).toHaveLength(4); // Kas/Penjualan pair + HPP/Persediaan pair
  const totalDebit = lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = lines.reduce((s, l) => s + Number(l.credit), 0);
  expect(totalDebit).toBe(totalCredit);
});

test('a sale decrements stock and rolls back if the journal write fails', async () => {
  const { tenant, tokoUnit, product } = await seedKonsumenTestTenant({ price: 15000, cost: 9000, stockQty: 2 });
  await expect(createSale(tenant.id, tokoUnit.id, { lines: [{ productId: product.id, qty: 3 }], createdBy: testUser.id }))
    .rejects.toThrow(); // insufficient stock
  const unchanged = await prisma.product.findUnique({ where: { id: product.id } });
  expect(unchanged.stockQty).toBe(2); // untouched, not partially decremented
});
```

- [ ] Add `postPosSale()` to `journal.ts` — new exported function, same shape as
      `postLoanPayment` (multiple `buildComponentLines` calls combined into one entry):

```typescript
export async function postPosSale(
  tx: TxClient,
  params: { tenantId: string; saleId: string; totalPrice: number; totalCost: number; entryDate: Date; description: string }
): Promise<void> {
  const [revenueLines, cogsLines] = await Promise.all([
    buildComponentLines(tx, params.tenantId, "SYSTEM", "", "SALE_REVENUE", params.totalPrice),
    buildComponentLines(tx, params.tenantId, "SYSTEM", "", "SALE_COGS", params.totalCost)
  ]);
  await createJournalEntry(tx, {
    tenantId: params.tenantId,
    entryDate: params.entryDate,
    sourceType: "POS_SALE",
    sourceId: params.saleId,
    description: params.description,
    lines: [...revenueLines, ...cogsLines]
  });
}
```

  (`sourceId: ""` for the `SYSTEM`-scoped mapping lookup — confirm against how `AccountMapping`'s
  `@@unique([tenantId, sourceType, sourceId, transactionKind])` treats `sourceId: null` vs `""`
  in Postgres before writing this; adjust `buildComponentLines`'s signature to accept
  `sourceId: string | null` if `SYSTEM` mappings are stored with a `null` `sourceId`, matching
  whatever `config/service.ts` already does when `sourceType === "SYSTEM"`.)

- [ ] Implement `sale.service.ts#createSale()`: inside one `prisma.$transaction`, validate
      stock ≥ requested qty for every line, decrement `Product.stockQty`, insert `POSSale` +
      `POSSaleLine` rows, call `postPosSale()`. Any failure (insufficient stock, missing
      mapping is *not* a failure — see `UNPOSTED_MISSING_MAPPING`, only a thrown error is)
      rolls the whole transaction back.

- [ ] Run tests — expected PASS.

- [ ] Regression checkpoint: `pnpm run test` — 100% pass, `tests/modules/loans/*` and
      `tests/modules/savings/*` untouched and green, confirming `postLoanPayment`/
      `postSavingTransaction`/`postLoanDisbursement` really are unaffected.

- [ ] Commit: `git commit -m "feat(konsumen): POS sale posting with stock decrement and balanced journal entry"`

---

## Day 3 — Routes, tenant isolation, regression, seed data

**Files:**
- Create: `apps/backend/src/modules/konsumen/sale.routes.ts`
- Modify: `apps/backend/src/app.ts` (or wherever routers are mounted — mirror `loans.routes.ts`'s mount point)
- Modify: `prisma/seed-ksu-demo.ts` (from the week-1 spike, if merged) or create
  `apps/backend/prisma/seed-konsumen-demo.ts` standalone
- Test: `apps/backend/tests/konsumen-routes.test.ts`

**Tasks:**

- [ ] Add routes, auth-guarded the same way `loans.routes.ts` is — `tenantId`/`unitId`
      access checked against `req.auth`, never trusted from the URL:
      - `POST /api/konsumen/products`
      - `GET /api/konsumen/products?unitId=`
      - `POST /api/konsumen/sales`
      - `GET /api/konsumen/sales?unitId=`

- [ ] Write + pass cross-tenant isolation test (same pattern as every other module's route test):

```typescript
test('cannot create a product for another tenant\'s unit', async () => {
  const tenantA = await createTestTenant();
  const tenantB = await createTestTenant();
  const res = await request(app)
    .post('/api/konsumen/products')
    .set('Authorization', bearerFor(tenantA))
    .send({ unitId: tenantB.konsumenUnit.id, sku: 'X', name: 'X', price: 1000, cost: 700 });
  expect(res.status).toBe(404); // or 403, per this codebase's existing convention — check loans.routes.ts
});
```

- [ ] Seed demo data: one `KONSUMEN` unit, 5 products, a few sales with realistic Rupiah
      prices, so the consolidated-reporting work from the KSP spike (once merged) has real
      Toko-side journal data to sum — this is what actually closes the "no Toko/POS" line in
      `docs/ksu-mvp-week1-demo.md`'s known-gaps list, not just having the tables exist.

- [ ] **Full regression suite — the critical stability gate:**
      Run: `pnpm run test`
      Expected: 100% pass, every pre-existing test file unmodified, including the KSP
      spike's own `tests/ksu-*.test.ts` if that branch is merged by this point.

- [ ] Manually verify: seed the demo data, hit `GET /api/konsumen/sales`, confirm returned
      totals match hand-calculated sums; confirm `GET /api/reports/ksu/consolidated` (from
      the KSP spike, once merged) picks up Toko unit assets once its `getLoanIdsForUnit`-style
      lookup is extended to also read `POSSale`/`Product` — **note:** the KSP spike's
      `consolidation.service.ts` as committed only reads Loan/Saving; it will need a small
      follow-up to also include `POSSale` once this branch merges. Flag that as the next task,
      don't silently scope-creep it into this plan.

- [ ] Commit: `git commit -m "feat(konsumen): POS routes, tenant-isolation test, and demo seed data"`

---

## End-of-plan acceptance checklist

- [ ] `Product`/`POSSale`/`POSSaleLine` exist with required `unitId`, consistent with `Saving`/`Loan`
- [ ] A sale correctly decrements stock, atomically with its journal entry
- [ ] Every POS sale posts a balanced 4-line journal entry (revenue pair + COGS pair)
- [ ] `journal.ts`'s three pre-existing exported functions are byte-for-byte unchanged
- [ ] Full existing test suite (KSP + KSU spike, if merged) passes unmodified
- [ ] Cross-tenant isolation verified on every new route
- [ ] Demo seed data exists so consolidated reporting has real Toko-side numbers to sum

## Explicitly out of scope for this plan

- Frontend UI (product list, POS register screen, receipt printing)
- Per-product account mappings (tenant-wide `SYSTEM` mapping only, matching how a small Toko
  actually runs its books — split by product category is a real post-MVP ask, not this one)
- Extending `consolidation.service.ts` to include `POSSale` (flagged above as the natural next
  task once both branches exist, not bundled in here to keep this plan's diff reviewable)
- Returns/refunds, discounts, or non-cash payment methods (utang/piutang toko) — first pass is cash-only
