import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

/**
 * Phase 2 (KSU Konsumen/Toko), Task 2 — thin HTTP routes over
 * modules/konsumen/product.service.ts, already tested at the service layer
 * in tests/konsumen-product.test.ts (same split as ksu-routes.test.ts over
 * ksu-member-statement.test.ts). These tests only prove the HTTP wiring:
 * auth/permission gating, tenant isolation surfacing as 404, and that the
 * response bodies match the DTO shapes docs/ksu-konsumen-frontend.md expects
 * exactly (sellPrice/costPrice/stockLevel as strings, never raw numbers).
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
  category: "Sembako",
  uom: "karung",
  sellPrice: "65000",
  costPrice: "58000"
};

describe("GET /api/konsumen/products", () => {
  it("lists active products for the given unit, shaped per the frontend DTO", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    await request(app())
      .post("/api/konsumen/products")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, ...SAMPLE_PRODUCT_BODY });

    const res = await request(app())
      .get(`/api/konsumen/products?unitId=${tokoUnit.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toEqual({
      id: expect.any(String),
      sku: "SKU-BERAS-5KG",
      name: "Beras Premium 5kg",
      category: "Sembako",
      uom: "karung",
      sellPrice: "65000",
      costPrice: "58000",
      stockLevel: "0",
      isActive: true
    });
  });

  it("requires authentication", async () => {
    const res = await request(app()).get("/api/konsumen/products?unitId=does-not-matter");
    expect(res.status).toBe(401);
  });

  it("404s for a unitId belonging to a different tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const tokoB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");

    const res = await request(app())
      .get(`/api/konsumen/products?unitId=${tokoB.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

describe("POST /api/konsumen/products", () => {
  it("creates a product and returns 201 with the created product", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const res = await request(app())
      .post("/api/konsumen/products")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, ...SAMPLE_PRODUCT_BODY });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      sku: "SKU-BERAS-5KG",
      sellPrice: "65000",
      costPrice: "58000",
      stockLevel: "0",
      isActive: true
    });

    const row = await db.product.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.tenantId).toBe(admin.user.tenantId);
    expect(row.unitId).toBe(tokoUnit.id);
  });

  it("rejects a product for a non-KONSUMEN unit", async () => {
    const admin = await setupTenant();
    const kspUnit = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } });

    const res = await request(app())
      .post("/api/konsumen/products")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: kspUnit.id, ...SAMPLE_PRODUCT_BODY });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns a conflict error on a duplicate SKU within the same unit", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    await request(app())
      .post("/api/konsumen/products")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, ...SAMPLE_PRODUCT_BODY });

    const res = await request(app())
      .post("/api/konsumen/products")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, ...SAMPLE_PRODUCT_BODY, name: "Beras Lain" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("404s when creating a product for another tenant's unit", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const tokoB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");

    const res = await request(app())
      .post("/api/konsumen/products")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ unitId: tokoB.id, ...SAMPLE_PRODUCT_BODY });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    const products = await db.product.findMany({ where: { tenantId: tenantB.user.tenantId } });
    expect(products).toEqual([]);
  });

  it("403s for a role without konsumen create permission", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await request(app())
      .post("/api/konsumen/products")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ unitId: tokoUnit.id, ...SAMPLE_PRODUCT_BODY });

    expect(res.status).toBe(403);
  });
});

describe("POST /api/konsumen/products/:id/stock-movements", () => {
  async function createProductAs(accessToken: string, unitId: string) {
    const res = await request(app())
      .post("/api/konsumen/products")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ unitId, ...SAMPLE_PRODUCT_BODY });
    return res.body.data as { id: string };
  }

  it("IN increases stockLevel and returns 201 with the updated product", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProductAs(admin.accessToken, tokoUnit.id);

    const res = await request(app())
      .post(`/api/konsumen/products/${product.id}/stock-movements`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "IN", quantity: 20, reason: "Restok awal" });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe(product.id);
    expect(res.body.data.stockLevel).toBe("20");
  });

  it("ADJUSTMENT sets stockLevel to the given quantity, not a delta on top of IN", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProductAs(admin.accessToken, tokoUnit.id);
    await request(app())
      .post(`/api/konsumen/products/${product.id}/stock-movements`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "IN", quantity: 20, reason: "Restok awal" });

    const res = await request(app())
      .post(`/api/konsumen/products/${product.id}/stock-movements`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "ADJUSTMENT", quantity: 12, reason: "Stok opname" });

    expect(res.status).toBe(201);
    expect(res.body.data.stockLevel).toBe("12");
  });

  it("rejects type: OUT with a validation error", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProductAs(admin.accessToken, tokoUnit.id);

    const res = await request(app())
      .post(`/api/konsumen/products/${product.id}/stock-movements`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "OUT", quantity: 5, reason: "Penjualan" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a non-positive quantity", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const product = await createProductAs(admin.accessToken, tokoUnit.id);

    const res = await request(app())
      .post(`/api/konsumen/products/${product.id}/stock-movements`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "IN", quantity: 0, reason: "Invalid" });

    expect(res.status).toBe(422);
  });

  it("404s for a productId belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const tokoB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");
    const productB = await createProductAs(tenantB.accessToken, tokoB.id);

    const res = await request(app())
      .post(`/api/konsumen/products/${productB.id}/stock-movements`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ type: "IN", quantity: 5, reason: "Test" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);

    const untouched = await db.product.findUniqueOrThrow({ where: { id: productB.id } });
    expect(untouched.stockQty).toBe(0);
  });

  it("404s for a nonexistent productId", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/konsumen/products/does-not-exist/stock-movements")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "IN", quantity: 5, reason: "Test" });

    expect(res.status).toBe(404);
  });
});

describe("GET /api/konsumen/stock-movements", () => {
  it("lists movements newest first with the DTO shape (productName joined, createdAt ISO)", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const productRes = await request(app())
      .post("/api/konsumen/products")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: tokoUnit.id, ...SAMPLE_PRODUCT_BODY });
    const product = productRes.body.data as { id: string };

    await request(app())
      .post(`/api/konsumen/products/${product.id}/stock-movements`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "IN", quantity: 20, reason: "Restok awal" });
    await request(app())
      .post(`/api/konsumen/products/${product.id}/stock-movements`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ type: "ADJUSTMENT", quantity: 18, reason: "Stok opname" });

    const res = await request(app())
      .get(`/api/konsumen/stock-movements?unitId=${tokoUnit.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toEqual({
      id: expect.any(String),
      productId: product.id,
      productName: "Beras Premium 5kg",
      type: "ADJUSTMENT",
      quantity: 18,
      reason: "Stok opname",
      createdAt: expect.any(String)
    });
    expect(res.body.data[1].type).toBe("IN");
  });

  it("404s for a unitId belonging to a different tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const tokoB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");

    const res = await request(app())
      .get(`/api/konsumen/stock-movements?unitId=${tokoB.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
