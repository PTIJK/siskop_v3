import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { errorRateAlert, getAttention, sortAttention } from "../src/modules/platform-dashboard/attention.js";
import { DAY, daysFrom, makeSubscribedTenant, seedCatalog } from "./billing-fixture.js";

const NOW = new Date("2026-10-31T12:00:00Z");

describe("errorRateAlert", () => {
  it("needs both enough traffic and a 5% error rate", () => {
    expect(errorRateAlert(1000, 50)).not.toBeNull();
    expect(errorRateAlert(1000, 49)).toBeNull();
    expect(errorRateAlert(19, 19)).toBeNull();
  });
});

describe("sortAttention", () => {
  it("orders critical, warning, info and keeps order within a severity", () => {
    const sorted = sortAttention([
      { id: "a", severity: "info", kind: "TENANT_NO_REGION", message: "a" },
      { id: "b", severity: "critical", kind: "ERROR_RATE", message: "b" },
      { id: "c", severity: "warning", kind: "TENANT_INACTIVE", message: "c" },
      { id: "d", severity: "critical", kind: "INVOICE_OVERDUE", message: "d" }
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("getAttention", () => {
  beforeEach(async () => {
    await db.tenant.deleteMany({});
    await db.requestMetricHourly.deleteMany({});
    await seedCatalog();
  });

  it("flags an OPEN invoice past its due date as critical", async () => {
    await makeSubscribedTenant({
      tag: "OVD",
      status: "ACTIVE",
      invoice: { dueDate: daysFrom(NOW, -5) }
    });
    const items = await getAttention(NOW);
    const overdue = items.find((i) => i.kind === "INVOICE_OVERDUE");
    expect(overdue).toMatchObject({ severity: "critical", href: "/platform/invoices" });
    expect(overdue?.message).toContain("Koperasi OVD");
    expect(overdue?.message).toContain("5 hari");
  });

  it("does not flag a paid or not-yet-due invoice", async () => {
    await makeSubscribedTenant({ tag: "PD", status: "ACTIVE", invoice: { status: "PAID", dueDate: daysFrom(NOW, -5) } });
    await makeSubscribedTenant({ tag: "FUT", status: "ACTIVE", invoice: { dueDate: daysFrom(NOW, 5) } });
    const items = await getAttention(NOW);
    expect(items.some((i) => i.kind === "INVOICE_OVERDUE")).toBe(false);
  });

  it("counts PAST_DUE subscriptions and renewals due within 7 days", async () => {
    await makeSubscribedTenant({ tag: "PAST", status: "PAST_DUE", invoice: null });
    await makeSubscribedTenant({ tag: "SOON", status: "ACTIVE", nextBillingDate: daysFrom(NOW, 3), invoice: null });
    await makeSubscribedTenant({ tag: "LATER", status: "ACTIVE", nextBillingDate: daysFrom(NOW, 20), invoice: null });
    const items = await getAttention(NOW);
    expect(items.find((i) => i.kind === "SUBSCRIPTION_PAST_DUE")?.message).toContain("1 langganan");
    expect(items.find((i) => i.kind === "BILLING_DUE_SOON")?.message).toContain("1 langganan");
  });

  it("lists active tenants nobody has logged into for 30 days, and tenants with no region", async () => {
    const t = await makeSubscribedTenant({ tag: "IDLE", status: "ACTIVE", invoice: null });
    await db.tenant.update({ where: { id: t.tenant.id }, data: { createdAt: new Date(NOW.getTime() - 60 * DAY) } });
    const items = await getAttention(NOW);
    expect(items.find((i) => i.kind === "TENANT_INACTIVE")?.message).toContain("Koperasi IDLE");
    expect(items.find((i) => i.kind === "TENANT_NO_REGION")).toMatchObject({ severity: "info", href: "/platform/tenants" });
  });

  it("reports the true idle-tenant count past the listing limit", async () => {
    const old = new Date(NOW.getTime() - 60 * DAY);
    await db.tenant.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        name: `Idle ${String(i).padStart(2, "0")}`,
        slug: `idle-${i}`,
        address: "Jl. Uji 1",
        registrationNo: `IDLE-${i}`,
        type: "KONVENSIONAL" as const,
        createdAt: old
      }))
    });
    const items = await getAttention(NOW);
    const idle = items.find((i) => i.kind === "TENANT_INACTIVE");
    expect(idle?.message).toMatch(/^60 koperasi aktif/);
    expect(idle?.message).toContain("dan 57 lainnya");
  });

  it("does not list a tenant with a recent staff login, an inactive tenant, or count a platform-admin login", async () => {
    const old = new Date(NOW.getTime() - 60 * DAY);
    const recent = await makeSubscribedTenant({ tag: "RECENT", status: "ACTIVE", invoice: null });
    const off = await makeSubscribedTenant({ tag: "OFF", status: "ACTIVE", isActive: false, invoice: null });
    const adminOnly = await makeSubscribedTenant({ tag: "ADMINONLY", status: "ACTIVE", invoice: null });
    for (const t of [recent, off, adminOnly]) {
      await db.tenant.update({ where: { id: t.tenant.id }, data: { createdAt: old } });
    }
    await db.user.update({
      where: { id: recent.admin.id, tenantId: recent.tenant.id },
      data: { lastLoginAt: new Date(NOW.getTime() - DAY) }
    });
    await db.user.create({
      data: {
        tenantId: adminOnly.tenant.id,
        roleId: adminOnly.admin.roleId,
        name: "Platform",
        email: "platform-only@bill-test.example",
        isPlatformAdmin: true,
        lastLoginAt: new Date(NOW.getTime() - DAY)
      }
    });

    const items = await getAttention(NOW);
    const idle = items.find((i) => i.kind === "TENANT_INACTIVE");
    expect(idle?.message).toMatch(/^1 koperasi aktif/);
    expect(idle?.message).toContain("Koperasi ADMINONLY");
    expect(idle?.message).not.toContain("Koperasi RECENT");
    expect(idle?.message).not.toContain("Koperasi OFF");
  });

  it("lists 10 overdue invoices and summarises the rest in one more item", async () => {
    const t = await makeSubscribedTenant({ tag: "MANY", status: "ACTIVE", invoice: { dueDate: daysFrom(NOW, -30) } });
    const inv = t.invoice!;
    await withoutTenantScope(async () =>
      db.invoice.createMany({
        data: Array.from({ length: 11 }, (_, i) => ({
          tenantId: inv.tenantId,
          subscriptionId: inv.subscriptionId,
          number: `${inv.number}-X${i}`,
          type: inv.type,
          subtotal: inv.subtotal,
          total: inv.total,
          dueDate: daysFrom(NOW, -(20 - i))
        }))
      })
    );

    const items = await getAttention(NOW);
    const overdue = items.filter((i) => i.kind === "INVOICE_OVERDUE");
    expect(overdue).toHaveLength(11);
    expect(overdue.filter((i) => i.id.startsWith("invoice:"))).toHaveLength(10);
    const more = overdue.at(-1);
    expect(more).toMatchObject({ id: "invoices-overdue-more", href: "/platform/invoices" });
    expect(more?.message).toBe("dan 2 faktur lainnya yang lewat jatuh tempo");
    expect(items.indexOf(more!)).toBe(items.indexOf(overdue[9]!) + 1);
  });

  it("raises ERROR_RATE from the last 24h of stored metrics", async () => {
    await db.requestMetricHourly.create({
      data: { hour: new Date("2026-10-31T09:00:00Z"), routeGroup: "GET /api/a", count: 200, errors5xx: 30, p50Ms: 10, p95Ms: 50 }
    });
    const items = await getAttention(NOW);
    expect(items[0]).toMatchObject({ kind: "ERROR_RATE", severity: "critical" });
  });
});
