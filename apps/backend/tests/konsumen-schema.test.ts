import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, setupTenant } from "./helpers.js";

/**
 * Phase 2 (KSU Konsumen/Toko), Task 1 — SCHEMA ONLY. This is a shape-lock
 * test, not business logic: no product/sale service layer exists yet (that's
 * a later task). It only proves:
 *   1. the new Product/POSSale/etc. tables are additive — a tenant with no
 *      KONSUMEN unit is completely unaffected (zero rows, no forced FK);
 *   2. each new model can be created directly via Prisma against a real
 *      KONSUMEN-type CooperativeUnit and round-trips id + Decimal fields
 *      correctly (Decimal, not Float/number — CLAUDE.md rule 2).
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

/** Mirrors ksu-consolidation.test.ts's createSecondUnit, parameterized by type. */
async function createUnit(accessToken: string, type: string, name: string) {
  const res = await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type, name });
  return res.body.data as { id: string; name: string };
}

describe("Konsumen schema (Product/POSSale/POSSaleLine/StockMovement/PPOBTransaction)", () => {
  it("a tenant with no KONSUMEN unit has zero products and the schema does not force one", async () => {
    const admin = await setupTenant(); // registers with a single default KSP unit only

    const products = await db.product.findMany({ where: { tenantId: admin.user.tenantId } });

    expect(products).toEqual([]);
  });

  it("creates and round-trips a Product/POSSale/POSSaleLine/StockMovement/PPOBTransaction against a KONSUMEN unit", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    const userId = admin.user.id;
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    expect(tokoUnit.id).toEqual(expect.any(String));

    const product = await db.product.create({
      data: {
        tenantId,
        unitId: tokoUnit.id,
        sku: "SKU-BERAS-5KG",
        name: "Beras Premium 5kg",
        category: "Sembako",
        uom: "karung",
        price: "65000.00",
        cost: "58000.00",
        stockQty: 20
      }
    });
    expect(product.id).toEqual(expect.any(String));
    expect(product.tenantId).toBe(tenantId);
    expect(product.unitId).toBe(tokoUnit.id);
    expect(product.price.toString()).toBe("65000");
    expect(product.cost.toString()).toBe("58000");
    expect(product.stockQty).toBe(20);
    expect(product.isActive).toBe(true);

    const sale = await db.pOSSale.create({
      data: {
        tenantId,
        unitId: tokoUnit.id,
        paymentMethod: "CASH",
        totalPrice: "195000.00",
        totalCost: "174000.00",
        createdBy: userId
      }
    });
    expect(sale.id).toEqual(expect.any(String));
    expect(sale.totalPrice.toString()).toBe("195000");
    expect(sale.totalCost.toString()).toBe("174000");
    expect(sale.memberId).toBeNull();

    const saleLine = await db.pOSSaleLine.create({
      data: {
        saleId: sale.id,
        productId: product.id,
        qty: 3,
        unitPrice: "65000.00",
        unitCost: "58000.00",
        subtotal: "195000.00"
      }
    });
    expect(saleLine.id).toEqual(expect.any(String));
    expect(saleLine.saleId).toBe(sale.id);
    expect(saleLine.productId).toBe(product.id);
    expect(saleLine.qty).toBe(3);
    expect(saleLine.subtotal.toString()).toBe("195000");

    const stockMovement = await db.stockMovement.create({
      data: {
        tenantId,
        unitId: tokoUnit.id,
        productId: product.id,
        type: "OUT",
        quantity: 3,
        reason: "POS sale",
        createdBy: userId
      }
    });
    expect(stockMovement.id).toEqual(expect.any(String));
    expect(stockMovement.type).toBe("OUT");
    expect(stockMovement.quantity).toBe(3);

    const ppobTransaction = await db.pPOBTransaction.create({
      data: {
        tenantId,
        unitId: tokoUnit.id,
        billType: "LISTRIK",
        customerNumber: "123456789",
        customerName: "Budi Santoso",
        amount: "50000.00",
        adminFee: "2500.00",
        createdBy: userId
      }
    });
    expect(ppobTransaction.id).toEqual(expect.any(String));
    expect(ppobTransaction.amount.toString()).toBe("50000");
    expect(ppobTransaction.adminFee.toString()).toBe("2500");
    expect(ppobTransaction.status).toBe("PENDING");

    // Round-trip: refetch everything by id and confirm persisted values match.
    const [refetchedProduct, refetchedSale, refetchedLines, refetchedMovement, refetchedPpob] = await Promise.all([
      db.product.findUniqueOrThrow({ where: { id: product.id } }),
      db.pOSSale.findUniqueOrThrow({ where: { id: sale.id } }),
      db.pOSSaleLine.findMany({ where: { saleId: sale.id } }),
      db.stockMovement.findUniqueOrThrow({ where: { id: stockMovement.id } }),
      db.pPOBTransaction.findUniqueOrThrow({ where: { id: ppobTransaction.id } })
    ]);
    expect(refetchedProduct.price.toString()).toBe("65000");
    expect(refetchedSale.totalPrice.toString()).toBe("195000");
    expect(refetchedLines).toHaveLength(1);
    expect(refetchedMovement.productId).toBe(product.id);
    expect(refetchedPpob.customerName).toBe("Budi Santoso");
  });
});
