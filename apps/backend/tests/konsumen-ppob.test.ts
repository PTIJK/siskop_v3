import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, setupTenant } from "./helpers.js";
import { simulateBill, checkBill, payBill } from "../src/modules/konsumen/ppob.service.js";
import { payPPOBBillSchema } from "../src/modules/konsumen/ppob.schema.js";

/**
 * Phase 2 (KSU Konsumen/Toko), Task 4 — PPOB check-and-pay skeleton.
 * Service-level tests. HTTP wiring lives in tests/konsumen-ppob-routes.test.ts
 * (same split as konsumen-product.test.ts vs konsumen-routes.test.ts).
 *
 * This is a deliberate STUB, not a real biller integration — see
 * modules/konsumen/ppob.service.ts's module doc. No journal entry is posted
 * here; journal.ts is untouched by this task (verified separately via
 * `git diff` in the task report, not by anything in this file).
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

describe("simulateBill", () => {
  it("is locked to an exact deterministic output for a specific customerNumber", () => {
    // digits of "123456789" sum to 45; 45 % 51 = 45; amount = 50_000 + 45*10_000 = 500_000.
    expect(simulateBill("LISTRIK", "123456789")).toEqual({
      amount: 500_000,
      adminFee: 2_500,
      customerName: "Pelanggan Demo"
    });
  });

  it("ignores non-digit characters (dashes/letters) in customerNumber", () => {
    // digits of "PLN-0011223344" sum to 20; 20 % 51 = 20; amount = 50_000 + 20*10_000 = 250_000.
    expect(simulateBill("LISTRIK", "PLN-0011223344")).toEqual({
      amount: 250_000,
      adminFee: 2_500,
      customerName: "Pelanggan Demo"
    });
  });

  it("is a pure function of (billType, customerNumber) — same input always produces the same output", () => {
    const a = simulateBill("PULSA", "081234567890");
    const b = simulateBill("PULSA", "081234567890");
    expect(a).toEqual(b);
  });

  it("stays within the documented Rp 50.000-Rp 550.000 range regardless of input", () => {
    for (const customerNumber of ["0", "999999999999999999999", "1", "PLN-AIR-BPJS-000"]) {
      const { amount } = simulateBill("AIR", customerNumber);
      expect(amount).toBeGreaterThanOrEqual(50_000);
      expect(amount).toBeLessThanOrEqual(550_000);
    }
  });
});

describe("checkBill", () => {
  it("returns the simulated amount/adminFee/customerName as Decimal-as-string, without writing a PPOBTransaction row", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const before = await db.pPOBTransaction.count({ where: { tenantId: admin.user.tenantId } });

    const result = await checkBill(
      admin.user.tenantId,
      { unitId: unit.id, billType: "LISTRIK", customerNumber: "123456789" },
      admin.user.id
    );

    expect(result).toEqual({ amount: "500000", adminFee: "2500", customerName: "Pelanggan Demo" });

    const after = await db.pPOBTransaction.count({ where: { tenantId: admin.user.tenantId } });
    expect(after).toBe(before);
  });

  it("404s when the unitId doesn't belong to the caller's tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");

    await expect(
      checkBill(
        tenantA.user.tenantId,
        { unitId: unitB.id, billType: "LISTRIK", customerNumber: "123456789" },
        tenantA.user.id
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("payBill", () => {
  it("writes a PPOBTransaction row with status PAID and the same deterministic amount checkBill would have returned", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const checked = await checkBill(
      admin.user.tenantId,
      { unitId: unit.id, billType: "LISTRIK", customerNumber: "123456789" },
      admin.user.id
    );

    const result = await payBill(
      admin.user.tenantId,
      { unitId: unit.id, billType: "LISTRIK", customerNumber: "123456789", adminFee: checked.adminFee },
      admin.user.id
    );

    expect(result.status).toBe("PAID");

    const row = await db.pPOBTransaction.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.status).toBe("PAID");
    expect(row.amount.toString()).toBe(checked.amount);
    expect(row.adminFee.toString()).toBe(checked.adminFee);
    expect(row.customerName).toBe("Pelanggan Demo");
    expect(row.tenantId).toBe(admin.user.tenantId);
    expect(row.unitId).toBe(unit.id);
    expect(row.billType).toBe("LISTRIK");
    expect(row.customerNumber).toBe("123456789");
    expect(row.createdBy).toBe(admin.user.id);
  });

  it("does not trust a client-supplied amount — the zod schema doesn't even accept an amount field, so it's silently dropped", () => {
    const parsed = payPPOBBillSchema.parse({
      unitId: "clx000000000000000000000",
      billType: "LISTRIK",
      customerNumber: "123456789",
      adminFee: "2500",
      amount: "999999999" // extra field a malicious/broken client might send
    });

    expect(parsed).not.toHaveProperty("amount");
  });

  it("re-derives the amount from customerNumber even if a client sent an out-of-band amount alongside it", async () => {
    const admin = await setupTenant();
    const unit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const result = await payBill(
      admin.user.tenantId,
      {
        unitId: unit.id,
        billType: "LISTRIK",
        customerNumber: "123456789",
        adminFee: "2500",
        // @ts-expect-error -- proving an extra "amount" key on the input object is ignored, not trusted
        amount: "1"
      },
      admin.user.id
    );

    const row = await db.pPOBTransaction.findUniqueOrThrow({ where: { id: result.id } });
    expect(row.amount.toString()).toBe("500000"); // the deterministic value for "123456789", not "1"
  });

  it("404s when the unitId doesn't belong to the caller's tenant, and leaves no row behind", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const unitB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");

    await expect(
      payBill(
        tenantA.user.tenantId,
        { unitId: unitB.id, billType: "LISTRIK", customerNumber: "123456789", adminFee: "2500" },
        tenantA.user.id
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const rows = await db.pPOBTransaction.findMany({ where: { tenantId: tenantB.user.tenantId } });
    expect(rows).toEqual([]);
  });
});
