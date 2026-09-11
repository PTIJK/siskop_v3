import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, setupTenant } from "./helpers.js";
import { createProduct, listProducts, listStockMovements, recordStockMovement } from "../src/modules/konsumen/product.service.js";

/**
 * Phase 2 (KSU Konsumen/Toko), Task 2 — Product CRUD + stock-movement
 * tracking, service layer. Mirrors tests/ksu-member-statement.test.ts's split
 * (service-level here, HTTP wiring in tests/konsumen-routes.test.ts).
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

const SAMPLE_PRODUCT = {
  sku: "SKU-BERAS-5KG",
  name: "Beras Premium 5kg",
  category: "Sembako",
  uom: "karung",
  sellPrice: 65_000,
  costPrice: 58_000
};

describe("createProduct", () => {
  it("creates a product for a KONSUMEN unit with stockQty 0 and Decimal fields serialized as strings", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const product = await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT }, admin.user.id);

    expect(product.id).toEqual(expect.any(String));
    expect(product.sku).toBe("SKU-BERAS-5KG");
    expect(product.name).toBe("Beras Premium 5kg");
    expect(product.category).toBe("Sembako");
    expect(product.uom).toBe("karung");
    expect(product.sellPrice).toBe("65000");
    expect(product.costPrice).toBe("58000");
    expect(product.stockLevel).toBe("0");
    expect(product.isActive).toBe(true);

    const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(row.stockQty).toBe(0);
    expect(row.price.toString()).toBe("65000");
  });

  it("defaults uom to 'pcs' and category to null when omitted", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const product = await createProduct(
      admin.user.tenantId,
      { unitId: tokoUnit.id, sku: "SKU-MINIMAL", name: "Produk Minimal", sellPrice: 1000, costPrice: 700 },
      admin.user.id
    );

    expect(product.uom).toBe("pcs");
    expect(product.category).toBeNull();
  });

  it("rejects creating a product against a non-KONSUMEN unit", async () => {
    const admin = await setupTenant(); // registers with a single default KSP unit only
    const kspUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    await expect(
      createProduct(admin.user.tenantId, { unitId: kspUnit.id, ...SAMPLE_PRODUCT }, admin.user.id)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const products = await db.product.findMany({ where: { tenantId: admin.user.tenantId } });
    expect(products).toEqual([]);
  });

  it("rejects a duplicate SKU within the same unit with a conflict error", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT }, admin.user.id);

    await expect(
      createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT, name: "Beras Lain" }, admin.user.id)
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const products = await db.product.findMany({ where: { tenantId: admin.user.tenantId, sku: SAMPLE_PRODUCT.sku } });
    expect(products).toHaveLength(1);
  });

  it("allows the same SKU across two different units", async () => {
    const admin = await setupTenant();
    const tokoA = await createUnit(admin.accessToken, "KONSUMEN", "Toko A");
    const tokoB = await createUnit(admin.accessToken, "KONSUMEN", "Toko B");

    const productA = await createProduct(admin.user.tenantId, { unitId: tokoA.id, ...SAMPLE_PRODUCT }, admin.user.id);
    const productB = await createProduct(admin.user.tenantId, { unitId: tokoB.id, ...SAMPLE_PRODUCT }, admin.user.id);

    expect(productA.id).not.toBe(productB.id);
  });

  it("throws NOT_FOUND for a unitId that doesn't belong to the caller's tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const tokoB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");

    await expect(
      createProduct(tenantA.user.tenantId, { unitId: tokoB.id, ...SAMPLE_PRODUCT }, tenantA.user.id)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listProducts", () => {
  it("lists only active products for the given unit", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT }, admin.user.id);
    await createProduct(
      admin.user.tenantId,
      { unitId: tokoUnit.id, sku: "SKU-GULA-1KG", name: "Gula Pasir 1kg", sellPrice: 15_000, costPrice: 12_000 },
      admin.user.id
    );

    const products = await listProducts(admin.user.tenantId, { unitId: tokoUnit.id }, admin.user.id);

    expect(products).toHaveLength(2);
    expect(products.map((p) => p.sku).sort()).toEqual(["SKU-BERAS-5KG", "SKU-GULA-1KG"]);
  });

  it("does not leak another unit's products", async () => {
    const admin = await setupTenant();
    const tokoA = await createUnit(admin.accessToken, "KONSUMEN", "Toko A");
    const tokoB = await createUnit(admin.accessToken, "KONSUMEN", "Toko B");
    await createProduct(admin.user.tenantId, { unitId: tokoA.id, ...SAMPLE_PRODUCT }, admin.user.id);

    const productsB = await listProducts(admin.user.tenantId, { unitId: tokoB.id }, admin.user.id);

    expect(productsB).toEqual([]);
  });
});

describe("recordStockMovement", () => {
  it("IN adds quantity on top of the current stock", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT }, admin.user.id);

    const afterFirst = await recordStockMovement(
      admin.user.tenantId,
      product.id,
      { type: "IN", quantity: 20, reason: "Restok awal" },
      admin.user.id
    );
    expect(afterFirst.stockLevel).toBe("20");

    const afterSecond = await recordStockMovement(
      admin.user.tenantId,
      product.id,
      { type: "IN", quantity: 5, reason: "Restok tambahan" },
      admin.user.id
    );
    expect(afterSecond.stockLevel).toBe("25");
  });

  it("ADJUSTMENT sets stockQty to the given quantity directly, not a delta", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT }, admin.user.id);
    await recordStockMovement(admin.user.tenantId, product.id, { type: "IN", quantity: 20, reason: "Restok awal" }, admin.user.id);

    // A physical stock-take counted 12 units on hand — the true count, not
    // "add 12". If this were treated as a delta the result would be 32.
    const afterAdjustment = await recordStockMovement(
      admin.user.tenantId,
      product.id,
      { type: "ADJUSTMENT", quantity: 12, reason: "Stok opname" },
      admin.user.id
    );

    expect(afterAdjustment.stockLevel).toBe("12");
  });

  it("ADJUSTMENT can lower stock down from a higher IN total", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT }, admin.user.id);
    await recordStockMovement(admin.user.tenantId, product.id, { type: "IN", quantity: 100, reason: "Restok" }, admin.user.id);

    const adjusted = await recordStockMovement(
      admin.user.tenantId,
      product.id,
      { type: "ADJUSTMENT", quantity: 3, reason: "Barang rusak/hilang" },
      admin.user.id
    );

    expect(adjusted.stockLevel).toBe("3");
  });

  it("creates a StockMovement row recording createdBy, type, quantity, and reason", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT }, admin.user.id);

    await recordStockMovement(admin.user.tenantId, product.id, { type: "IN", quantity: 20, reason: "Restok awal" }, admin.user.id);

    const movement = await db.stockMovement.findFirstOrThrow({
      where: { productId: product.id, tenantId: admin.user.tenantId }
    });
    expect(movement.type).toBe("IN");
    expect(movement.quantity).toBe(20);
    expect(movement.reason).toBe("Restok awal");
    expect(movement.createdBy).toBe(admin.user.id);
    expect(movement.unitId).toBe(tokoUnit.id);
    expect(movement.tenantId).toBe(admin.user.tenantId);
  });

  it("throws NOT_FOUND for a productId that doesn't belong to the caller's tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const tokoB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");
    const productB = await createProduct(tenantB.user.tenantId, { unitId: tokoB.id, ...SAMPLE_PRODUCT }, tenantB.user.id);

    await expect(
      recordStockMovement(tenantA.user.tenantId, productB.id, { type: "IN", quantity: 5, reason: "Test" }, tenantA.user.id)
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listStockMovements", () => {
  it("lists movements for a unit newest first, joining the product name", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProduct(admin.user.tenantId, { unitId: tokoUnit.id, ...SAMPLE_PRODUCT }, admin.user.id);

    await recordStockMovement(admin.user.tenantId, product.id, { type: "IN", quantity: 20, reason: "Restok awal" }, admin.user.id);
    await recordStockMovement(admin.user.tenantId, product.id, { type: "ADJUSTMENT", quantity: 15, reason: "Stok opname" }, admin.user.id);

    const movements = await listStockMovements(admin.user.tenantId, { unitId: tokoUnit.id }, admin.user.id);

    expect(movements).toHaveLength(2);
    expect(movements[0].type).toBe("ADJUSTMENT");
    expect(movements[0].reason).toBe("Stok opname");
    expect(movements[0].productName).toBe(SAMPLE_PRODUCT.name);
    expect(movements[0].productId).toBe(product.id);
    expect(movements[0].id).toEqual(expect.any(String));
    expect(movements[0].createdAt).toEqual(expect.any(String));
    expect(movements[1].type).toBe("IN");
  });

  it("does not leak another unit's stock movements", async () => {
    const admin = await setupTenant();
    const tokoA = await createUnit(admin.accessToken, "KONSUMEN", "Toko A");
    const tokoB = await createUnit(admin.accessToken, "KONSUMEN", "Toko B");
    const productA = await createProduct(admin.user.tenantId, { unitId: tokoA.id, ...SAMPLE_PRODUCT }, admin.user.id);
    await recordStockMovement(admin.user.tenantId, productA.id, { type: "IN", quantity: 20, reason: "Restok" }, admin.user.id);

    const movementsB = await listStockMovements(admin.user.tenantId, { unitId: tokoB.id }, admin.user.id);

    expect(movementsB).toEqual([]);
  });
});
