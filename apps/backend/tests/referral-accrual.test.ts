import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { confirmPayment } from "../src/lib/payments/confirm.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { commissionAmount, referralWindowEnd } from "../src/lib/referrals/accrue.js";
import { cleanBilling, makeSubscribedTenant, paymentsOf, seedCatalog } from "./billing-fixture.js";
import { cleanReferrals, commissionsOf, makeReferral } from "./referral-fixture.js";

const NOW = new Date("2026-03-10T08:00:00.000Z");

beforeAll(() => {
  if (!new URL(process.env.DATABASE_URL ?? "postgresql://localhost/missing").pathname.endsWith("_test"))
    throw new Error("Use a dedicated database ending in _test for these integration tests");
});
beforeEach(async () => {
  await cleanReferrals();
  await cleanBilling();
  // VAT on, so the commission base (subtotal) differs from what was paid (total).
  await seedCatalog({ withVat: true });
  clearEntitlementCache();
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await cleanReferrals();
  await cleanBilling();
  await db.$disconnect();
});

describe("commissionAmount", () => {
  const amount = (base: string, rate: string) => commissionAmount(new Prisma.Decimal(base), new Prisma.Decimal(rate)).toFixed(2);

  it("is base × rate", () => {
    expect(amount("150000", "0.2")).toBe("30000.00");
  });

  it("rounds half up to 2 decimals", () => {
    expect(amount("99999.99", "0.1234")).toBe("12340.00");
    expect(amount("0.05", "0.1")).toBe("0.01");
    expect(amount("0.04", "0.1")).toBe("0.00");
  });
});

describe("referralWindowEnd", () => {
  it("adds calendar months in UTC, clamping to the end of a short month", () => {
    expect(referralWindowEnd(new Date("2026-03-10T08:00:00.000Z"), 12).toISOString()).toBe("2027-03-10T08:00:00.000Z");
    expect(referralWindowEnd(new Date("2026-01-31T00:00:00.000Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });
});

describe("confirmPayment accrues referral commission", () => {
  it("records one ACCRUED commission on the invoice subtotal at the referral's snapshotted rate", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "R1" });
    // The partner's current rate is 20%; this koperasi was signed at 15%.
    const { partner, referral } = await makeReferral(tenant.id, { rate: "0.15" });

    await confirmPayment(invoice!.id, { now: NOW, confirmedBy: "admin-1" });

    const [payment] = await paymentsOf(tenant.id);
    const rows = await commissionsOf(tenant.id);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row).toMatchObject({ partnerId: partner.id, referralId: referral.id, invoiceId: invoice!.id, paymentId: payment!.id, status: "ACCRUED" });
    expect(invoice!.subtotal.eq(invoice!.total)).toBe(false);
    expect(row.baseAmount.toFixed(2)).toBe(invoice!.subtotal.toFixed(2));
    expect(row.rate.toFixed(4)).toBe("0.1500");
    expect(row.amount.toFixed(2)).toBe(commissionAmount(invoice!.subtotal, new Prisma.Decimal("0.15")).toFixed(2));
    expect(row.accruedAt.toISOString()).toBe(NOW.toISOString());

    const audit = await db.pricingAuditLog.findFirst({ where: { entity: "referral_commission", entityId: row.id } });
    expect(audit).toMatchObject({ action: "ACCRUED", actorId: "admin-1" });
  });

  it("is idempotent: confirming the same invoice again adds nothing", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "R2" });
    await makeReferral(tenant.id);

    await confirmPayment(invoice!.id, { now: NOW });
    await confirmPayment(invoice!.id, { now: NOW });

    expect(await commissionsOf(tenant.id)).toHaveLength(1);
  });

  it("does nothing for a koperasi without a referral", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "R3" });

    const result = await confirmPayment(invoice!.id, { now: NOW });

    expect(result.alreadyPaid).toBe(false);
    expect(await commissionsOf(tenant.id)).toHaveLength(0);
  });

  it("does nothing once the commission window has ended", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "R4" });
    // Attributed 2025-03-10 for 12 months: window ends exactly at NOW (exclusive).
    await makeReferral(tenant.id, { attributedAt: new Date("2025-03-10T08:00:00.000Z"), months: 12 });

    await confirmPayment(invoice!.id, { now: NOW });

    expect(await commissionsOf(tenant.id)).toHaveLength(0);
  });

  it("does nothing for a payment made before the koperasi was attributed", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "R5" });
    await makeReferral(tenant.id, { attributedAt: new Date("2026-03-11T00:00:00.000Z") });

    await confirmPayment(invoice!.id, { now: NOW });

    expect(await commissionsOf(tenant.id)).toHaveLength(0);
  });

  it("does nothing at a 0% rate (commission paused)", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "R6" });
    await makeReferral(tenant.id, { rate: "0" });

    await confirmPayment(invoice!.id, { now: NOW });

    expect(await commissionsOf(tenant.id)).toHaveLength(0);
  });

  it("keeps earning for a suspended partner's existing referrals", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "R7" });
    await makeReferral(tenant.id, { partnerStatus: "SUSPENDED" });

    await confirmPayment(invoice!.id, { now: NOW });

    expect(await commissionsOf(tenant.id)).toHaveLength(1);
  });

  it("accrues on renewal invoices too", async () => {
    const { tenant, invoice } = await makeSubscribedTenant({ tag: "R8", status: "ACTIVE", invoice: { type: "RENEWAL" }, nextBillingDate: NOW });
    await makeReferral(tenant.id);

    await confirmPayment(invoice!.id, { now: NOW });

    expect(await commissionsOf(tenant.id)).toHaveLength(1);
  });
});
