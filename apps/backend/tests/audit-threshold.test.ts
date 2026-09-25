import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { checkAuditThreshold } from "../src/modules/config/audit-threshold.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.SCHEDULER_SECRET = "test-scheduler-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function setModalDisetor(tenantId: string, value: string | null) {
  await db.tenant.update({
    where: { id: tenantId },
    data: { modalDisetor: value === null ? null : new Prisma.Decimal(value) }
  });
}

async function auditNotifications(tenantId: string) {
  return db.tenantNotification.findMany({ where: { tenantId, type: "AUDIT_THRESHOLD_EXCEEDED" } });
}

describe("checkAuditThreshold (Permenkop UKM 2/2024 Pasal 12)", () => {
  it("notifies a tenant whose modal disetor reaches Rp5 miliar and stamps auditThresholdNotifiedAt", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await setModalDisetor(tenantId, "5000000000");
    const asOf = new Date("2026-03-01T00:00:00Z");

    const result = await checkAuditThreshold(asOf, tenantId);

    expect(result).toEqual({ checked: 1, notified: 1, failed: 0 });
    const notifications = await auditNotifications(tenantId);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].permissionModule).toBe("config");
    expect(notifications[0].permissionAction).toBe("read");
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.auditThresholdNotifiedAt?.toISOString()).toBe(asOf.toISOString());
  });

  it("skips a tenant below the threshold, including one at Rp5 juta", async () => {
    const admin = await setupTenant();
    await setModalDisetor(admin.user.tenantId, "4999999999.99");
    const other = await setupTenant({ slug: "demo2", registrationNo: "KOP-DEMO2" });
    await setModalDisetor(other.user.tenantId, "5000000");

    const result = await checkAuditThreshold(new Date("2026-03-01T00:00:00Z"));

    expect(result.notified).toBe(0);
    expect(await auditNotifications(admin.user.tenantId)).toHaveLength(0);
    expect(await auditNotifications(other.user.tenantId)).toHaveLength(0);
  });

  it("notifies only once per calendar year, and again the next year", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await setModalDisetor(tenantId, "6000000000");

    await checkAuditThreshold(new Date("2026-03-01T00:00:00Z"), tenantId);
    const sameYear = await checkAuditThreshold(new Date("2026-11-01T00:00:00Z"), tenantId);
    expect(sameYear.notified).toBe(0);
    expect(await auditNotifications(tenantId)).toHaveLength(1);

    const nextYear = await checkAuditThreshold(new Date("2027-01-02T00:00:00Z"), tenantId);
    expect(nextYear.notified).toBe(1);
    expect(await auditNotifications(tenantId)).toHaveLength(2);
  });

  it("only touches tenants over the threshold", async () => {
    const over = await setupTenant();
    await setModalDisetor(over.user.tenantId, "5000000000");
    const under = await setupTenant({ slug: "demo2", registrationNo: "KOP-DEMO2" });
    await setModalDisetor(under.user.tenantId, "100");

    await checkAuditThreshold(new Date("2026-03-01T00:00:00Z"));

    expect(await auditNotifications(over.user.tenantId)).toHaveLength(1);
    expect(await auditNotifications(under.user.tenantId)).toHaveLength(0);
    const underTenant = await db.tenant.findUniqueOrThrow({ where: { id: under.user.tenantId } });
    expect(underTenant.auditThresholdNotifiedAt).toBeNull();
  });

  it("shows the notification to a Manager (config.read) but not to a Viewer", async () => {
    const admin = await setupTenant();
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");
    await setModalDisetor(admin.user.tenantId, "5000000000");

    await checkAuditThreshold(new Date(), admin.user.tenantId);

    const managerRes = await request(app()).get("/api/notifications").set("Authorization", `Bearer ${manager.accessToken}`);
    const viewerRes = await request(app()).get("/api/notifications").set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(managerRes.body.data).toHaveLength(1);
    expect(managerRes.body.data[0].type).toBe("AUDIT_THRESHOLD_EXCEEDED");
    expect(viewerRes.body.data).toHaveLength(0);
  });

  it("runs as part of the daily scheduler", async () => {
    const admin = await setupTenant();
    await setModalDisetor(admin.user.tenantId, "5000000000");

    const res = await request(app()).post("/api/scheduler/run-daily").set("x-scheduler-token", "test-scheduler-secret");

    expect(res.status).toBe(200);
    expect(res.body.data.auditThreshold).toEqual({ checked: 1, notified: 1, failed: 0 });
    expect(await auditNotifications(admin.user.tenantId)).toHaveLength(1);
  });
});
