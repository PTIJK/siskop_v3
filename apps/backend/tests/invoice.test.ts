import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { buildSubscriptionSnapshot, quote } from "../src/lib/pricing/engine.js";
import { allocateInvoiceNumber, createInvoice } from "../src/lib/pricing/invoice.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import type { CatalogSnapshot } from "../src/lib/pricing/snapshot.js";
import { seedJson } from "./pricing-fixture.js";
import { setupTenant } from "./helpers.js";

let published: { version: number; snapshot: CatalogSnapshot };

beforeAll(async () => {
  await withoutTenantScope(async () => db.invoice.deleteMany({}));
  await withoutTenantScope(async () => db.tenantSubscription.deleteMany({}));
  await db.packageFeature.deleteMany({});
  await db.feature.deleteMany({});
  await db.subscriptionPackage.deleteMany({ where: { code: { not: null } } });
  await db.volumeAddon.deleteMany({});
  await db.supportPlan.deleteMany({});
  await db.pricingSetting.deleteMany({});
  await db.pricingVersion.deleteMany({});
  await db.pricingAuditLog.deleteMany({});
  await loadPricingSeed(db, parsePricingSeed(seedJson({ withVat: true })));
  const v = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
  published = { version: 1, snapshot: v.snapshot as unknown as CatalogSnapshot };
});

afterEach(async () => {
  await withoutTenantScope(async () => db.invoice.deleteMany({}));
  await withoutTenantScope(async () => db.tenantSubscription.deleteMany({}));
  await db.tenant.deleteMany({});
});

let seq = 0;
async function subscribedTenant() {
  seq += 1;
  const session = await setupTenant({ slug: `inv-${seq}`, registrationNo: `INV-${seq}`, adminEmail: `a${seq}@inv.test` });
  const tenantId = session.user.tenantId;
  const selection = { packageCode: "small", billingCycle: "MONTHLY" as const };
  const pkg = await db.subscriptionPackage.findUniqueOrThrow({ where: { code: "small" } });
  const sub = await db.tenantSubscription.create({
    data: {
      tenantId,
      packageId: pkg.id,
      pricingVersion: 1,
      billingCycle: "MONTHLY",
      snapshot: buildSubscriptionSnapshot(selection, published) as never,
      amountPerCycle: 500_000,
      status: "PENDING_PAYMENT",
      startsAt: new Date(),
      createdVia: "REGISTRATION"
    }
  });
  return { tenantId, subscriptionId: sub.id, selection };
}

describe("allocateInvoiceNumber", () => {
  it("starts a month at 0001 in the INV-YYYYMM-NNNN format", async () => {
    const n = await db.$transaction((tx) => allocateInvoiceNumber(tx, new Date("2026-10-15T10:00:00.000Z")));
    expect(n).toBe("INV-202610-0001");
  });

  it("continues the sequence within a month and restarts in the next", async () => {
    const { tenantId, subscriptionId, selection } = await subscribedTenant();
    const q = quote(selection, published);
    const make = (when: string) =>
      db.$transaction((tx) => createInvoice(tx, { tenantId, subscriptionId, type: "RENEWAL", quote: q, dueDate: new Date(when), now: new Date(when) }));

    const a = await make("2026-10-01T00:00:00.000Z");
    const b = await make("2026-10-31T23:00:00.000Z");
    const c = await make("2026-11-01T00:00:00.000Z");

    expect([a.number, b.number, c.number]).toEqual(["INV-202610-0001", "INV-202610-0002", "INV-202611-0001"]);
  });

  it("hands out distinct numbers to simultaneous callers", async () => {
    const { tenantId, subscriptionId, selection } = await subscribedTenant();
    const q = quote(selection, published);
    const now = new Date("2026-12-05T00:00:00.000Z");

    const made = await Promise.all(
      Array.from({ length: 8 }, () => db.$transaction((tx) => createInvoice(tx, { tenantId, subscriptionId, type: "RENEWAL", quote: q, dueDate: now, now })))
    );

    const numbers = made.map((i) => i.number).sort();
    expect(new Set(numbers).size).toBe(8);
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => `INV-202612-${String(i + 1).padStart(4, "0")}`));
  });

  it("keeps counting past 9999 without breaking the order", async () => {
    const { tenantId, subscriptionId, selection } = await subscribedTenant();
    const q = quote(selection, published);
    const now = new Date("2027-01-10T00:00:00.000Z");
    await db.invoice.create({
      data: { tenantId, subscriptionId, number: "INV-202701-9999", type: "RENEWAL", subtotal: 1, taxAmount: 0, total: 1, dueDate: now }
    });

    const next = await db.$transaction((tx) => createInvoice(tx, { tenantId, subscriptionId, type: "RENEWAL", quote: q, dueDate: now, now }));

    expect(next.number).toBe("INV-202701-10000");
  });
});

describe("deleting a tenant", () => {
  it("removes its subscription, invoices and payments without a foreign-key error", async () => {
    const { tenantId, subscriptionId, selection } = await subscribedTenant();
    const inv = await db.$transaction((tx) =>
      createInvoice(tx, { tenantId, subscriptionId, type: "REGISTRATION", quote: quote(selection, published), dueDate: new Date() })
    );
    await db.payment.create({ data: { tenantId, invoiceId: inv.id, method: "MANUAL", amount: 500_000, paidAt: new Date() } });

    await db.tenant.delete({ where: { id: tenantId } });

    expect(await withoutTenantScope(async () => db.invoice.count({ where: { tenantId } }))).toBe(0);
    expect(await withoutTenantScope(async () => db.tenantSubscription.count({ where: { tenantId } }))).toBe(0);
    expect(await withoutTenantScope(async () => db.payment.count({ where: { tenantId } }))).toBe(0);
  });
});

describe("createInvoice", () => {
  it("stores the quote's subtotal, VAT and total as Decimals and starts OPEN", async () => {
    const { tenantId, subscriptionId, selection } = await subscribedTenant();
    const q = quote({ ...selection, supportPlanCode: "SP1" }, published);
    const due = new Date("2026-11-20T00:00:00.000Z");

    const inv = await db.$transaction((tx) => createInvoice(tx, { tenantId, subscriptionId, type: "REGISTRATION", quote: q, dueDate: due }));

    expect(inv.status).toBe("OPEN");
    expect(inv.type).toBe("REGISTRATION");
    expect(inv.subtotal.toString()).toBe("5500000");
    expect(inv.taxRate?.toString()).toBe("0.11");
    expect(inv.taxAmount.toString()).toBe("605000");
    expect(inv.total.toString()).toBe("6105000");
    expect(inv.dueDate.toISOString()).toBe(due.toISOString());
  });

  it("stores no VAT rate when the owner has none", async () => {
    const { tenantId, subscriptionId, selection } = await subscribedTenant();
    const noVat = structuredClone(published);
    noVat.snapshot.settings.taxRate = null;

    const inv = await db.$transaction((tx) =>
      createInvoice(tx, { tenantId, subscriptionId, type: "REGISTRATION", quote: quote(selection, noVat), dueDate: new Date() })
    );

    expect(inv.taxRate).toBeNull();
    expect(inv.taxAmount.toString()).toBe("0");
    expect(inv.total.toString()).toBe("500000");
  });
});
