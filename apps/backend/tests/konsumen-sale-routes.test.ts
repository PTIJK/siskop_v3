import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

/**
 * Phase 2 (KSU Konsumen/Toko), Task 3 — thin HTTP routes over
 * modules/konsumen/sale.service.ts, already tested at the service layer in
 * tests/konsumen-sale.test.ts (same split as konsumen-routes.test.ts over
 * konsumen-product.test.ts). These tests only prove the HTTP wiring:
 * auth/permission gating, tenant isolation, and the response shapes pinned by
 * the task contract (`{ id, totalAmount }` on create, Decimal-as-string).
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

const SAMPLE_PRODUCT_BODY = {
  sku: "SKU-BERAS-5KG",
  name: "Beras Premium 5kg",
  sellPrice: "15000",
  costPrice: "9000"
};

async function seedTokoWithStock(accessToken: string, stockQty = 10) {
  const tokoUnit = await createUnit(accessToken, "KONSUMEN", "Toko Koperasi");
  const productRes = await request(app())
    .post("/api/konsumen/products")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ unitId: tokoUnit.id, ...SAMPLE_PRODUCT_BODY });
  const product = productRes.body.data as { id: string };

  if (stockQty > 0) {
    await request(app())
      .post(`/api/konsumen/products/${product.id}/stock-movements`)
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ type: "IN", quantity: stockQty, reason: "Restok awal" });
  }

  return { tokoUnit, product };
}

describe("POST /api/konsumen/pos/sales", () => {
  it("creates a sale and returns 201 with { id, totalAmount }", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin.accessToken);

    const res = await request(app())
      .post("/api/konsumen/pos/sales")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 3 }], paymentMethod: "CASH" });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ id: expect.any(String), totalAmount: "45000" });

    const row = await db.pOSSale.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.tenantId).toBe(admin.user.tenantId);
    expect(row.unitId).toBe(tokoUnit.id);
  });

  it("requires authentication", async () => {
    const res = await request(app())
      .post("/api/konsumen/pos/sales")
      .send({ unitId: "does-not-matter", items: [], paymentMethod: "CASH" });
    expect(res.status).toBe(401);
  });

  it("returns a validation error and rolls back stock when a line's quantity exceeds available stock", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin.accessToken, 2);

    const res = await request(app())
      .post("/api/konsumen/pos/sales")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 3 }], paymentMethod: "CASH" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    const unchanged = await db.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(unchanged.stockQty).toBe(2);

    const sales = await db.pOSSale.findMany({ where: { tenantId: admin.user.tenantId } });
    expect(sales).toEqual([]);
  });

  it("rejects an empty items array with a validation error", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const res = await request(app())
      .post("/api/konsumen/pos/sales")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, items: [], paymentMethod: "CASH" });

    expect(res.status).toBe(422);
  });

  it("rejects an invalid paymentMethod", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin.accessToken);

    const res = await request(app())
      .post("/api/konsumen/pos/sales")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "UTANG" });

    expect(res.status).toBe(422);
  });

  it("404s when creating a sale against another tenant's unit/product, and leaves no rows behind", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const { tokoUnit: tokoB, product: productB } = await seedTokoWithStock(tenantB.accessToken);

    const res = await request(app())
      .post("/api/konsumen/pos/sales")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ unitId: tokoB.id, items: [{ productId: productB.id, quantity: 1 }], paymentMethod: "CASH" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    const sales = await db.pOSSale.findMany({ where: { tenantId: tenantB.user.tenantId } });
    expect(sales).toEqual([]);
    const untouched = await db.product.findUniqueOrThrow({ where: { id: productB.id } });
    expect(untouched.stockQty).toBe(10);
  });

  it("403s for a role without konsumen create permission", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin.accessToken);
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await request(app())
      .post("/api/konsumen/pos/sales")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "CASH" });

    expect(res.status).toBe(403);
  });

  it("allows a Teller (front-counter staff) to ring up a sale", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin.accessToken);
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .post("/api/konsumen/pos/sales")
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .send({ unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "CASH" });

    expect(res.status).toBe(201);
  });
});

describe("GET /api/konsumen/pos/sales", () => {
  it("lists sales for the given unit, newest first", async () => {
    const admin = await setupTenant();
    const { tokoUnit, product } = await seedTokoWithStock(admin.accessToken);
    await request(app())
      .post("/api/konsumen/pos/sales")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "CASH" });
    await request(app())
      .post("/api/konsumen/pos/sales")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, items: [{ productId: product.id, quantity: 2 }], paymentMethod: "TRANSFER" });

    const res = await request(app())
      .get(`/api/konsumen/pos/sales?unitId=${tokoUnit.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({
      id: expect.any(String),
      totalAmount: "30000",
      paymentMethod: "TRANSFER",
      memberId: null,
      lineCount: 1
    });
    expect(res.body.data[0].soldAt).toEqual(expect.any(String));
  });

  it("requires authentication", async () => {
    const res = await request(app()).get("/api/konsumen/pos/sales?unitId=does-not-matter");
    expect(res.status).toBe(401);
  });

  it("404s for a unitId belonging to a different tenant (cross-tenant isolation)", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const { tokoUnit: tokoB } = await seedTokoWithStock(tenantB.accessToken);

    const res = await request(app())
      .get(`/api/konsumen/pos/sales?unitId=${tokoB.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
