import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { confirmPayment } from "../src/lib/payments/confirm.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { getAttention } from "../src/modules/platform-dashboard/attention.js";
import { getReferralSummary } from "../src/modules/platform-dashboard/referrals.js";
import { cleanBilling, makeSubscribedTenant, seedCatalog } from "./billing-fixture.js";
import { cleanReferrals, commissionsOf, makePartner, makeReferral } from "./referral-fixture.js";

const NOW = new Date("2026-10-31T12:00:00Z");
let seq = 0;

/** One commission for `partnerId`, accrued at `paidAt`. */
async function accrue(partnerId: string, paidAt: string) {
  const { tenant, invoice } = await makeSubscribedTenant({ tag: `DR${++seq}` });
  await makeReferral(tenant.id, { partnerId, rate: "0.2", attributedAt: new Date("2026-01-01T00:00:00.000Z") });
  await confirmPayment(invoice!.id, { now: new Date(paidAt), confirmedBy: "admin" });
  return (await commissionsOf(tenant.id))[0]!;
}

beforeEach(async () => {
  await cleanReferrals();
  await cleanBilling();
  await db.tenant.deleteMany({});
  await seedCatalog({ withVat: true });
  clearEntitlementCache();
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});
afterAll(async () => {
  await cleanReferrals();
  await cleanBilling();
  await db.tenant.deleteMany({});
  await db.$disconnect();
});

describe("getReferralSummary", () => {
  it("is all zeros when the program has no data", async () => {
    expect(await getReferralSummary(NOW)).toEqual({
      activePartners: 0,
      pendingApplications: 0,
      referredTenants: 0,
      referredRevenueThisMonth: "0.00",
      referredRevenueTotal: "0.00",
      commissionThisMonth: "0.00",
      commissionOutstanding: "0.00"
    });
  });

  it("counts only ACTIVE partners and PENDING applications", async () => {
    await makePartner({ status: "ACTIVE" });
    await makePartner({ status: "ACTIVE" });
    await makePartner({ status: "SUSPENDED" });
    await makePartner({ status: "REJECTED", code: null });
    await makePartner({ status: "PENDING", code: null });
    const s = await getReferralSummary(NOW);
    expect(s).toMatchObject({ activePartners: 2, pendingApplications: 1 });
  });

  it("splits referred revenue and commission by Jakarta month, on the invoice subtotal", async () => {
    const partner = await makePartner();
    const oct = await accrue(partner.id, "2026-10-15T08:00:00.000Z");
    // 18:00 UTC on 30 Sep is 01:00 WIB on 1 Oct: still October.
    const lateSep = await accrue(partner.id, "2026-09-30T18:00:00.000Z");
    const sep = await accrue(partner.id, "2026-09-10T08:00:00.000Z");

    const s = await getReferralSummary(NOW);
    expect(s.referredTenants).toBe(3);
    expect(s.referredRevenueThisMonth).toBe(oct.baseAmount.plus(lateSep.baseAmount).toFixed(2));
    expect(s.referredRevenueTotal).toBe(oct.baseAmount.plus(lateSep.baseAmount).plus(sep.baseAmount).toFixed(2));
    expect(s.commissionThisMonth).toBe(oct.amount.plus(lateSep.amount).toFixed(2));
    expect(oct.baseAmount.eq(oct.amount)).toBe(false);
  });

  it("leaves voided commissions out, and counts everything ACCRUED as outstanding, drafts included", async () => {
    const partner = await makePartner();
    const kept = await accrue(partner.id, "2026-10-15T08:00:00.000Z");
    const voided = await accrue(partner.id, "2026-10-16T08:00:00.000Z");
    const paid = await accrue(partner.id, "2026-10-17T08:00:00.000Z");
    await withoutTenantScope(async () => {
      await db.referralCommission.update({ where: { id: voided.id }, data: { status: "VOID", voidReason: "salah" } });
      await db.referralCommission.update({ where: { id: paid.id }, data: { status: "PAID" } });
    });

    const s = await getReferralSummary(NOW);
    expect(s.referredRevenueTotal).toBe(kept.baseAmount.plus(paid.baseAmount).toFixed(2));
    expect(s.commissionOutstanding).toBe(kept.amount.toFixed(2));
    expect(s.commissionThisMonth).toBe(kept.amount.plus(paid.amount).toFixed(2));
  });
});

describe("attention for partner applications", () => {
  it("lists pending applications with a link to the review queue, and nothing when there are none", async () => {
    const none = (await getAttention(NOW)).filter((i) => i.kind === "PARTNER_APPLICATIONS");
    expect(none).toHaveLength(0);

    await makePartner({ status: "PENDING", code: null });
    await makePartner({ status: "PENDING", code: null });
    const item = (await getAttention(NOW)).find((i) => i.kind === "PARTNER_APPLICATIONS");
    expect(item).toMatchObject({ severity: "warning", href: "/platform/partners" });
    expect(item!.message).toContain("2");
  });
});
