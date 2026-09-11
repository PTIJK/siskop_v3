import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, createStaffSession, setupTenant } from "./helpers.js";

/**
 * Phase — Konsumen/Toko "Kredit Anggota": thin HTTP routes over
 * modules/konsumen/credit.service.ts, already tested at the service layer in
 * tests/konsumen-credit.test.ts (same split as konsumen-sale.test.ts vs
 * konsumen-sale-routes.test.ts). These tests prove the HTTP wiring: auth,
 * permission gating (konsumen:read/update — deliberately not members:*, so a
 * Kasir who lacks members permissions can still use this at the register),
 * and tenant isolation.
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

/** Rings up a MEMBER_CREDIT sale via the real API so a member has `amount` of outstanding store credit to repay. */
async function createCreditDebt(accessToken: string, memberId: string, amount: number) {
  const unitRes = await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type: "KONSUMEN", name: "Toko Koperasi" });
  const unit = unitRes.body.data as { id: string };

  const productRes = await request(app())
    .post("/api/konsumen/products")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ unitId: unit.id, sku: "SKU-DEBT", name: "Produk", sellPrice: amount, costPrice: Math.floor(amount * 0.6) });
  const product = productRes.body.data as { id: string };

  await request(app())
    .post(`/api/konsumen/products/${product.id}/stock-movements`)
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type: "IN", quantity: 1, reason: "Restok" });

  await request(app())
    .post("/api/konsumen/pos/sales")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ unitId: unit.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: "MEMBER_CREDIT", memberId });
}

describe("GET /api/konsumen/pos/credit/members", () => {
  it("finds a member by search term", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const res = await request(app())
      .get("/api/konsumen/pos/credit/members?search=Budi")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      expect.objectContaining({ id: member.id, fullName: "Budi Santoso" })
    ]);
  });

  it("requires authentication", async () => {
    const res = await request(app()).get("/api/konsumen/pos/credit/members?search=Budi");
    expect(res.status).toBe(401);
  });

  it("allows a Kasir (who lacks members:read) to search", async () => {
    const admin = await setupTenant();
    await createMemberWithPokokSaving(admin.accessToken);
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.test");

    const res = await request(app())
      .get("/api/konsumen/pos/credit/members?search=Budi")
      .set("Authorization", `Bearer ${kasir.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("does not leak another tenant's members", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    await createMemberWithPokokSaving(tenantB.accessToken);

    const res = await request(app())
      .get("/api/konsumen/pos/credit/members?search=Budi")
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});

describe("GET /api/konsumen/pos/credit/:memberId", () => {
  it("returns the member's credit status", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const res = await request(app())
      .get(`/api/konsumen/pos/credit/${member.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      memberId: member.id,
      savingsBalance: "500000",
      creditLimit: "250000",
      outstandingBalance: "0",
      availableCredit: "250000",
      hasActiveSaving: true,
      eligible: true
    });
  });

  it("allows a Kasir to read a member's credit status", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.test");

    const res = await request(app())
      .get(`/api/konsumen/pos/credit/${member.id}`)
      .set("Authorization", `Bearer ${kasir.accessToken}`);

    expect(res.status).toBe(200);
  });

  it("404s for a memberId belonging to a different tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const memberB = await createMemberWithPokokSaving(tenantB.accessToken);

    const res = await request(app())
      .get(`/api/konsumen/pos/credit/${memberB.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe("POST /api/konsumen/pos/credit/repayments", () => {
  it("records a repayment and returns the updated outstanding balance", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await createCreditDebt(admin.accessToken, member.id, 50_000);

    const res = await request(app())
      .post("/api/konsumen/pos/credit/repayments")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, amount: 50_000 });

    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ id: expect.any(String), outstandingBalance: "0" });
  });

  it("requires authentication", async () => {
    const res = await request(app())
      .post("/api/konsumen/pos/credit/repayments")
      .send({ memberId: "does-not-matter", amount: 1 });
    expect(res.status).toBe(401);
  });

  it("403s for a Viewer (read-only, no konsumen:update)", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await request(app())
      .post("/api/konsumen/pos/credit/repayments")
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ memberId: member.id, amount: 1 });

    expect(res.status).toBe(403);
  });

  it("allows a Kasir to record a repayment", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);
    await createCreditDebt(admin.accessToken, member.id, 50_000);
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.test");

    const res = await request(app())
      .post("/api/konsumen/pos/credit/repayments")
      .set("Authorization", `Bearer ${kasir.accessToken}`)
      .send({ memberId: member.id, amount: 10_000 });

    expect(res.status).toBe(201);
  });

  it("rejects an amount exceeding the outstanding balance with a validation error", async () => {
    const admin = await setupTenant();
    const member = await createMemberWithPokokSaving(admin.accessToken);

    const res = await request(app())
      .post("/api/konsumen/pos/credit/repayments")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ memberId: member.id, amount: 1 });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});
