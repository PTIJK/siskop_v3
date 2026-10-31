import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { deltaPct, getRevenue, mrrOf } from "../src/modules/platform-dashboard/revenue.js";
import { makeSubscribedTenant, seedCatalog } from "./billing-fixture.js";

const NOW = new Date("2026-10-31T12:00:00Z");
const D = (v: string) => new Prisma.Decimal(v);

describe("deltaPct", () => {
  it("is the percent change to one decimal", () => {
    expect(deltaPct(D("150"), D("100"))).toBe(50);
    expect(deltaPct(D("100"), D("300"))).toBe(-66.7);
  });
  it("is null when there is no previous month to compare", () => {
    expect(deltaPct(D("100"), D("0"))).toBeNull();
  });
});

describe("mrrOf", () => {
  it("counts monthly as-is and spreads yearly over 12 months", () => {
    const total = mrrOf([
      { billingCycle: "MONTHLY", amountPerCycle: D("500000") },
      { billingCycle: "YEARLY", amountPerCycle: D("1200000") }
    ]);
    expect(total.toFixed(2)).toBe("600000.00");
  });
});

describe("getRevenue", () => {
  beforeEach(async () => {
    await db.tenant.deleteMany({});
    await seedCatalog();
  });

  it("sums payments on PAID invoices per month and ignores unpaid invoices", async () => {
    const paid = await makeSubscribedTenant({ tag: "REVA", status: "ACTIVE", invoice: { status: "PAID" } });
    const open = await makeSubscribedTenant({ tag: "REVB", status: "ACTIVE", invoice: { status: "OPEN" } });
    await db.payment.create({
      data: { tenantId: paid.tenant.id, invoiceId: paid.invoice!.id, method: "VA", amount: "500000", paidAt: new Date("2026-10-15T00:00:00Z") }
    });
    await db.payment.create({
      data: { tenantId: paid.tenant.id, invoiceId: paid.invoice!.id, method: "VA", amount: "250000", paidAt: new Date("2026-09-10T00:00:00Z") }
    });
    await db.payment.create({
      data: { tenantId: open.tenant.id, invoiceId: open.invoice!.id, method: "VA", amount: "999999", paidAt: new Date("2026-10-20T00:00:00Z") }
    });

    const r = await getRevenue(NOW);

    expect(r.series).toHaveLength(12);
    expect(r.series.at(-1)).toEqual({ month: "2026-10", amount: "500000.00" });
    expect(r.series.at(-2)).toEqual({ month: "2026-09", amount: "250000.00" });
    expect(r.thisMonth).toBe("500000.00");
    expect(r.previousMonth).toBe("250000.00");
    expect(r.deltaPct).toBe(100);
  });

  it("buckets payments by Jakarta calendar month", async () => {
    const paid = await makeSubscribedTenant({ tag: "REVJ", status: "ACTIVE", invoice: { status: "PAID" } });
    // 2026-11-01 03:00 WIB
    await db.payment.create({
      data: { tenantId: paid.tenant.id, invoiceId: paid.invoice!.id, method: "VA", amount: "100000", paidAt: new Date("2026-10-31T20:00:00Z") }
    });

    const r = await getRevenue(new Date("2026-11-01T01:00:00Z"));

    expect(r.series.at(-1)).toEqual({ month: "2026-11", amount: "100000.00" });
    expect(r.series.at(-2)).toEqual({ month: "2026-10", amount: "0.00" });
  });

  it("reports MRR from ACTIVE subscriptions only", async () => {
    const active = await makeSubscribedTenant({ tag: "MRRA", status: "ACTIVE", invoice: null });
    await makeSubscribedTenant({ tag: "MRRB", status: "PENDING_PAYMENT", invoice: null });

    const r = await getRevenue(NOW);

    expect(r.mrr).toBe(active.subscription.amountPerCycle.toFixed(2));
  });
});
