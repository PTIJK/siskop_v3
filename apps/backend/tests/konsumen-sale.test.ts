import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberAs, setupTenant } from "./helpers.js";
import { createProduct, recordStockMovement } from "../src/modules/konsumen/product.service.js";
import { createSale, listSales } from "../src/modules/konsumen/sale.service.js";

/**
 * Phase 2 (KSU Konsumen/Toko), Task 3 — POS sale posting: service-level.
 * HTTP wiring lives in tests/konsumen-sale-routes.test.ts (same split as
 * konsumen-product.test.ts vs konsumen-routes.test.ts).
 *
 * The most load-bearing assertions here are that lib/journal.ts's three
 * pre-existing exported functions (postSavingTransaction/postLoanDisbursement/
 * postLoanPayment) are byte-for-byte unaffected by this task's additions —
 * proven by running tests/loans.test.ts and tests/savings.test.ts UNMODIFIED
 * as part of the full suite, not by anything in this file.
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function createUnit(accessToken: string, type: string, name: string) {
  const res = await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type, name });
  return res.body.data as { id: string; name: string };
}

async function createAccount(
  accessToken: string,
  data: { code: string; name: string; category: string; normalBalance: string }
) {
  const res = await request(app())
    .post("/api/config/accounts")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(data);
  return res.body.data as { id: string };
}

async function createAccountMapping(
  accessToken: string,
  data: { sourceType: string; transactionKind: string; debitAccountId: string; creditAccountId: string }
) {
  const res = await request(app())
    .post("/api/config/account-mappings")
    .set("Authorization", `Bearer ${accessToken}`)
    .send(data);
  return res.body.data;
}

/** Wires up tenant-wide SYSTEM/SALE_REVENUE (Kas/Penjualan) + SYSTEM/SALE_COGS (HPP/Persediaan) mappings. */
async function setupSaleMappings(accessToken: string) {
  const kas = await createAccount(accessToken, { code: "1-1000", name: "Kas", category: "ASET", normalBalance: "DEBIT" });
  const penjualan = await createAccount(accessToken, {
    code: "4-1000",
    name: "Penjualan",
    category: "PENDAPATAN",
    normalBalance: "KREDIT"
  });
  const hpp = await createAccount(accessToken, { code: "5-1000", name: "HPP", category: "BEBAN", normalBalance: "DEBIT" });
  const persediaan = await createAccount(accessToken, {
    code: "1-1300",
    name: "Persediaan Barang Dagang",
    category: "ASET",
    normalBalance: "DEBIT"
  });

  await createAccountMapping(accessToken, {
    sourceType: "SYSTEM",
    transactionKind: "SALE_REVENUE",
    debitAccountId: kas.id,
    creditAccountId: penjualan.id
  });
  await createAccountMapping(accessToken, {
    sourceType: "SYSTEM",
    transactionKind: "SALE_COGS",
    debitAccountId: hpp.id,
    creditAccountId: persediaan.id
  });

  return { kas, penjualan, hpp, persediaan };
}

const SAMPLE_PRODUCT = {
  sku: "SKU-BERAS-5KG",
  name: "Beras Premium 5kg",
  sellPrice: 15_000,
  costPrice: 9_000
};

async function seedTokoWithStock(admin: Awaited<ReturnType<typeof setupTenant>>, stockQty: number) {
  const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
  const product = await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT });
  if (stockQty > 0) {
    await recordStockMovement(admin.user.tenantId, product.id, { type: "IN", quantity: stockQty, reason: "Restok awal" }, admin.user.id);
  }
  return { tokoUnit, product };
}

describe("createSale", () => {
  it("posts a balanced 4-line journal entry (revenue pair + COGS pair) for a sale", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin, 10);
    await setupSaleMappings(admin.accessToken);

    const sale = await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 3 }], paymentMethod: "CASH" },
      admin.user.id
    );

    expect(sale.id).toEqual(expect.any(String));
    expect(sale.totalAmount).toBe("45000"); // 15000 * 3

    const lines = await db.journalLine.findMany({
      where: { tenantId: admin.user.tenantId, journalEntry: { sourceType: "POS_SALE", sourceId: sale.id } }
    });
    expect(lines).toHaveLength(4);

    const totalDebit = lines.reduce((sum, l) => sum + Number(l.debit), 0);
    const totalCredit = lines.reduce((sum, l) => sum + Number(l.credit), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(72_000); // (15000*3) revenue pair + (9000*3) COGS pair

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "POS_SALE", sourceId: sale.id }
    });
    expect(entry.status).toBe("POSTED");
    expect(entry.tenantId).toBe(admin.user.tenantId);
  });

  it("decrements stock and records an OUT StockMovement per line", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin, 10);

    await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 4 }], paymentMethod: "CASH" },
      admin.user.id
    );

    const updated = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updated.stockQty).toBe(6);

    const movement = await db.stockMovement.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, productId: product.id, type: "OUT" }
    });
    expect(movement.quantity).toBe(4);
    expect(movement.unitId).toBe(tokoUnit.id);
    expect(movement.tenantId).toBe(admin.user.tenantId);
  });

  it("inserts POSSale + POSSaleLine rows with the correct totals", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin, 10);

    const sale = await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 2 }], paymentMethod: "CASH" },
      admin.user.id
    );

    const saleRow = await db.pOSSale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(saleRow.totalPrice.toString()).toBe("30000");
    expect(saleRow.totalCost.toString()).toBe("18000");
    expect(saleRow.unitId).toBe(tokoUnit.id);
    expect(saleRow.tenantId).toBe(admin.user.tenantId);

    const lines = await db.pOSSaleLine.findMany({ where: { saleId: sale.id } });
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
    expect(lines[0].unitPrice.toString()).toBe("15000");
    expect(lines[0].unitCost.toString()).toBe("9000");
    expect(lines[0].subtotal.toString()).toBe("30000");
  });

  it("rolls back everything when a line's requested quantity exceeds stock — stock unchanged, no POSSale, no journal entry", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin, 2);
    await setupSaleMappings(admin.accessToken);

    await expect(
      createSale(
        admin.user.tenantId,
        { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 3 }], paymentMethod: "CASH" },
        admin.user.id
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const unchanged = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(unchanged.stockQty).toBe(2);

    const outMovements = await db.stockMovement.findMany({
      where: { tenantId: admin.user.tenantId, productId: product.id, type: "OUT" }
    });
    expect(outMovements).toEqual([]);

    const sales = await db.pOSSale.findMany({ where: { tenantId: admin.user.tenantId } });
    expect(sales).toEqual([]);

    const entries = await db.journalEntry.findMany({ where: { tenantId: admin.user.tenantId, sourceType: "POS_SALE" } });
    expect(entries).toEqual([]);
  });

  it("rolls back the whole sale (not just the offending line) when only the second of two lines has insufficient stock", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const productA = await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT });
    await recordStockMovement(admin.user.tenantId, productA.id, { type: "IN", quantity: 10, reason: "Restok" }, admin.user.id);
    const productB = await createProduct(admin.user.tenantId, {
      unitId: tokoUnit.id,
      sku: "SKU-GULA-1KG",
      name: "Gula Pasir 1kg",
      sellPrice: 15_000,
      costPrice: 12_000
    });
    await recordStockMovement(admin.user.tenantId, productB.id, { type: "IN", quantity: 1, reason: "Restok" }, admin.user.id);

    await expect(
      createSale(
        admin.user.tenantId,
        {
          unitId: tokoUnit.id,
          items: [
            { productId: productA.id, quantity: 5 },
            { productId: productB.id, quantity: 2 } // only 1 in stock
          ],
          paymentMethod: "CASH"
        },
        admin.user.id
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const unchangedA = await db.product.findUniqueOrThrow({ where: { id: productA.id } });
    expect(unchangedA.stockQty).toBe(10); // untouched even though it had enough stock

    const unchangedB = await db.product.findUniqueOrThrow({ where: { id: productB.id } });
    expect(unchangedB.stockQty).toBe(1);
  });

  it("throws NOT_FOUND for a memberId that doesn't belong to the caller's tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const { tokoUnit, product } = await seedTokoWithStock(tenantA, 10);
    const memberB = await createMemberAs(tenantB.accessToken);

    await expect(
      createSale(
        tenantA.user.tenantId,
        { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "CASH", memberId: memberB.id },
        tenantA.user.id
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const unchanged = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(unchanged.stockQty).toBe(10);
  });

  it("throws NOT_FOUND for a productId that doesn't belong to the caller's tenant/unit", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const { tokoUnit } = await seedTokoWithStock(tenantA, 10);
    const { product: productB } = await seedTokoWithStock(tenantB, 10);

    await expect(
      createSale(
        tenantA.user.tenantId,
        { unitId: tokoUnit.id, items: [{ productId: productB.id, quantity: 1 }], paymentMethod: "CASH" },
        tenantA.user.id
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("still completes the sale (UNPOSTED_MISSING_MAPPING) when no SYSTEM account mapping exists yet — a missing mapping must never block the sale", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin, 10);

    const sale = await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "CASH" },
      admin.user.id
    );

    const saleRow = await db.pOSSale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(saleRow).toBeTruthy();

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { tenantId: admin.user.tenantId, sourceType: "POS_SALE", sourceId: sale.id }
    });
    expect(entry.status).toBe("UNPOSTED_MISSING_MAPPING");

    const lines = await db.journalLine.findMany({ where: { tenantId: admin.user.tenantId, journalEntryId: entry.id } });
    expect(lines).toEqual([]);

    const updatedProduct = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(updatedProduct.stockQty).toBe(9); // stock decrement still happens regardless of mapping state
  });

  it("records the memberId on the sale when supplied, and null when omitted", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin, 10);

    const member = await createMemberAs(admin.accessToken);
    const memberId = member.id;

    const saleWithMember = await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "CASH", memberId },
      admin.user.id
    );
    const rowWithMember = await db.pOSSale.findUniqueOrThrow({ where: { id: saleWithMember.id } });
    expect(rowWithMember.memberId).toBe(memberId);

    const saleWithoutMember = await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "CASH" },
      admin.user.id
    );
    const rowWithoutMember = await db.pOSSale.findUniqueOrThrow({ where: { id: saleWithoutMember.id } });
    expect(rowWithoutMember.memberId).toBeNull();
  });
});

describe("listSales", () => {
  it("lists a unit's sales newest first, tenant/unit-scoped", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin, 10);

    const first = await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "CASH" },
      admin.user.id
    );
    const second = await createSale(
      admin.user.tenantId,
      { unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 2 }], paymentMethod: "TRANSFER" },
      admin.user.id
    );

    const sales = await listSales(admin.user.tenantId, { unitId: tokoUnit.id });

    expect(sales).toHaveLength(2);
    expect(sales[0].id).toBe(second.id);
    expect(sales[0].totalAmount).toBe("30000");
    expect(sales[0].paymentMethod).toBe("TRANSFER");
    expect(sales[0].lineCount).toBe(1);
    expect(sales[0].memberId).toBeNull();
    expect(sales[0].soldAt).toEqual(expect.any(String));
    expect(sales[1].id).toBe(first.id);
  });

  it("does not leak another unit's sales", async () => {
    const admin = await setupTenant();
    const { tokoUnit: tokoA, product: productA } = await seedTokoWithStock(admin, 10);
    const tokoB = await createUnit(admin.accessToken, "KONSUMEN", "Toko B");

    await createSale(
      admin.user.tenantId,
      { unitId: tokoA.id, items: [{ productId: productA.id, quantity: 1 }], paymentMethod: "CASH" },
      admin.user.id
    );

    const salesB = await listSales(admin.user.tenantId, { unitId: tokoB.id });
    expect(salesB).toEqual([]);
  });
});
