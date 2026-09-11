import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

/**
 * Phase 2 (KSU Konsumen/Toko), Task 4 — thin HTTP routes over
 * modules/konsumen/ppob.service.ts, already tested at the service layer in
 * tests/konsumen-ppob.test.ts (same split as konsumen-routes.test.ts over
 * konsumen-product.test.ts). These tests only prove the HTTP wiring:
 * auth/permission gating, tenant isolation, and the response shapes pinned by
 * the task contract (Decimal-as-string on /check, `{ id, status }` on /pay).
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

describe("POST /api/konsumen/ppob/check", () => {
  it("returns the simulated bill without writing a PPOBTransaction row", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const res = await request(app())
      .post("/api/konsumen/ppob/check")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: unit.id, billType: "LISTRIK", customerNumber: "123456789" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ amount: "500000", adminFee: "2500", customerName: "Pelanggan Demo" });

    const count = await db.pPOBTransaction.count({ where: { tenantId: admin.user.tenantId } });
    expect(count).toBe(0);
  });

  it("requires authentication", async () => {
    const res = await request(app())
      .post("/api/konsumen/ppob/check")
      .send({ unitId: "does-not-matter", billType: "LISTRIK", customerNumber: "123456789" });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid billType", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const res = await request(app())
      .post("/api/konsumen/ppob/check")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: unit.id, billType: "TV_KABEL", customerNumber: "123456789" });

    expect(res.status).toBe(422);
  });

  it("404s for a unitId belonging to a different tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");

    const res = await request(app())
      .post("/api/konsumen/ppob/check")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ unitId: unitB.id, billType: "LISTRIK", customerNumber: "123456789" });

    expect(res.status).toBe(404);
  });
});

describe("POST /api/konsumen/ppob/pay", () => {
  it("creates a PAID PPOBTransaction and returns 201 with { id, status }", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const res = await request(app())
      .post("/api/konsumen/ppob/pay")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: unit.id, billType: "LISTRIK", customerNumber: "123456789", adminFee: "2500" });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ id: expect.any(String), status: "PAID" });

    const row = await db.pPOBTransaction.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.status).toBe("PAID");
    expect(row.amount.toString()).toBe("500000");
    expect(row.tenantId).toBe(admin.user.tenantId);
    expect(row.unitId).toBe(unit.id);
  });

  it("ignores a client-supplied amount and re-derives it deterministically", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const res = await request(app())
      .post("/api/konsumen/ppob/pay")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitId: unit.id, billType: "LISTRIK", customerNumber: "123456789", adminFee: "2500", amount: "1" });

    expect(res.status).toBe(201);
    const row = await db.pPOBTransaction.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.amount.toString()).toBe("500000");
  });

  it("requires authentication", async () => {
    const res = await request(app())
      .post("/api/konsumen/ppob/pay")
      .send({ unitId: "does-not-matter", billType: "LISTRIK", customerNumber: "123456789", adminFee: "2500" });
    expect(res.status).toBe(401);
  });

  it("404s for a unitId belonging to a different tenant, and leaves no row behind", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");

    const res = await request(app())
      .post("/api/konsumen/ppob/pay")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ unitId: unitB.id, billType: "LISTRIK", customerNumber: "123456789", adminFee: "2500" });

    expect(res.status).toBe(404);

    const rows = await db.pPOBTransaction.findMany({ where: { tenantId: tenantB.user.tenantId } });
    expect(rows).toEqual([]);
  });

  it("403s for a role without konsumen create permission", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await request(app())
      .post("/api/konsumen/ppob/pay")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ unitId: unit.id, billType: "LISTRIK", customerNumber: "123456789", adminFee: "2500" });

    expect(res.status).toBe(403);
  });

  it("allows a Teller (front-counter staff) to pay a bill", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .post("/api/konsumen/ppob/pay")
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .send({ unitId: unit.id, billType: "LISTRIK", customerNumber: "123456789", adminFee: "2500" });

    expect(res.status).toBe(201);
  });
});
