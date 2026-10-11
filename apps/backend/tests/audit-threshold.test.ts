import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import { db } from "../src/lib/db.js";
import { checkAuditThreshold } from "../src/modules/config/audit-threshold.js";
import { app, createStaffSession, postEquity, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  process.env.SCHEDULER_SECRET = "test-scheduler-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

// Pasal 12(1) judges the modal of a tahun buku, so the check reads Modal
// Sendiri from the ledger as of the previous 31 December (WIB).
const IN_2025 = new Date("2025-12-15T00:00:00Z");
const IN_2026 = new Date("2026-02-10T00:00:00Z");
const MARCH_2026 = new Date("2026-03-01T00:00:00Z");

async function notifications(tenantId: string, type: string) {
  return db.tenantNotification.findMany({ where: { tenantId, type } });
}

const exceeded = (tenantId: string) => notifications(tenantId, "AUDIT_THRESHOLD_EXCEEDED");
const approaching = (tenantId: string) => notifications(tenantId, "AUDIT_THRESHOLD_APPROACHING");

describe("checkAuditThreshold (Permenkop UKM 2/2024 Pasal 12)", () => {
  it("notifies a tenant whose Modal Sendiri at the previous year end reached Rp5 miliar, naming that tahun buku", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "SIMPANAN_WAJIB", "5000000000", { entryDate: IN_2025 });

    const result = await checkAuditThreshold(MARCH_2026, tenantId);

    expect(result).toEqual({ checked: 1, notified: 1, failed: 0 });
    const rows = await exceeded(tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.message).toContain("tahun buku 2025");
    expect(rows[0]!.message).toContain("Rp5.000.000.000");
    expect(rows[0]).toMatchObject({ permissionModule: "config", permissionAction: "read" });
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.auditThresholdNotifiedAt?.toISOString()).toBe(MARCH_2026.toISOString());
  });

  it("includes the opening-balance adjustment", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "SIMPANAN_POKOK", "1000000000", { entryDate: IN_2025 });
    await db.modalSendiriAdjustment.create({
      data: { tenantId, effectiveDate: new Date("2025-01-01T00:00:00Z"), amount: "4000000000", reason: "Saldo awal", createdBy: "test" }
    });

    await checkAuditThreshold(MARCH_2026, tenantId);

    expect(await exceeded(tenantId)).toHaveLength(1);
  });

  it("skips a tenant below the threshold, including one at Rp5 juta", async () => {
    const admin = await setupTenant();
    await postEquity(admin.user.tenantId, "SIMPANAN_WAJIB", "4999999999.99", { entryDate: IN_2025 });
    const other = await setupTenant({ slug: "demo2", registrationNo: "KOP-DEMO2" });
    await postEquity(other.user.tenantId, "SIMPANAN_WAJIB", "5000000", { entryDate: IN_2025 });

    const result = await checkAuditThreshold(MARCH_2026);

    expect(result.notified).toBe(0);
    expect(await exceeded(admin.user.tenantId)).toHaveLength(0);
    expect(await exceeded(other.user.tenantId)).toHaveLength(0);
  });

  it("does not count modal penyertaan toward the threshold", async () => {
    const admin = await setupTenant();
    await postEquity(admin.user.tenantId, "MODAL_PENYERTAAN", "9000000000", { entryDate: IN_2025 });

    const result = await checkAuditThreshold(MARCH_2026, admin.user.tenantId);

    expect(result.notified).toBe(0);
  });

  it("ignores the legacy manual modal disetor field", async () => {
    const admin = await setupTenant();
    await db.tenant.update({ where: { id: admin.user.tenantId }, data: { modalDisetor: new Prisma.Decimal("9000000000") } });

    const result = await checkAuditThreshold(MARCH_2026, admin.user.tenantId);

    expect(result.notified).toBe(0);
  });

  it("only checks tenants that run simpan pinjam — Pasal 12(2) leaves sektor riil criteria to the Deputi", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "SIMPANAN_WAJIB", "6000000000", { entryDate: IN_2025 });
    await db.cooperativeUnit.create({ data: { tenantId, type: "KONSUMEN", name: "Toko" } });
    await db.cooperativeUnit.updateMany({ where: { tenantId, type: "KSP" }, data: { isActive: false } });

    const result = await checkAuditThreshold(MARCH_2026, tenantId);

    expect(result).toEqual({ checked: 0, notified: 0, failed: 0 });
  });

  it("notifies only once per calendar year, and again the next year", async () => {
    const admin = await setupTenant();
    const tenantId = admin.user.tenantId;
    await postEquity(tenantId, "SIMPANAN_WAJIB", "6000000000", { entryDate: IN_2025 });

    await checkAuditThreshold(MARCH_2026, tenantId);
    const sameYear = await checkAuditThreshold(new Date("2026-11-01T00:00:00Z"), tenantId);
    expect(sameYear.notified).toBe(0);
    expect(await exceeded(tenantId)).toHaveLength(1);

    const nextYear = await checkAuditThreshold(new Date("2027-01-02T00:00:00Z"), tenantId);
    expect(nextYear.notified).toBe(1);
    expect(await exceeded(tenantId)).toHaveLength(2);
  });

  describe("early warning for the running tahun buku", () => {
    it("warns once a year when Modal Sendiri crosses the threshold during the year", async () => {
      const admin = await setupTenant();
      const tenantId = admin.user.tenantId;
      await postEquity(tenantId, "SIMPANAN_WAJIB", "3000000000", { entryDate: IN_2025 });
      await postEquity(tenantId, "SIMPANAN_WAJIB", "2000000000", { entryDate: IN_2026 });

      const first = await checkAuditThreshold(MARCH_2026, tenantId);
      const again = await checkAuditThreshold(new Date("2026-04-01T00:00:00Z"), tenantId);

      expect(first.notified).toBe(1);
      expect(again.notified).toBe(0);
      expect(await exceeded(tenantId)).toHaveLength(0);
      const rows = await approaching(tenantId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.message).toContain("tahun buku 2026");
    });

    it("does not warn while the running figure is below the threshold", async () => {
      const admin = await setupTenant();
      await postEquity(admin.user.tenantId, "SIMPANAN_WAJIB", "4000000000", { entryDate: IN_2026 });

      const result = await checkAuditThreshold(MARCH_2026, admin.user.tenantId);

      expect(result.notified).toBe(0);
      expect(await approaching(admin.user.tenantId)).toHaveLength(0);
    });

    it("sends only the mandatory-audit notice when last year's figure already crossed", async () => {
      const admin = await setupTenant();
      const tenantId = admin.user.tenantId;
      await postEquity(tenantId, "SIMPANAN_WAJIB", "6000000000", { entryDate: IN_2025 });

      await checkAuditThreshold(MARCH_2026, tenantId);

      expect(await exceeded(tenantId)).toHaveLength(1);
      expect(await approaching(tenantId)).toHaveLength(0);
    });
  });

  it("shows the notification to a Manager (config.read) but not to a Viewer", async () => {
    const admin = await setupTenant();
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");
    await postEquity(admin.user.tenantId, "SIMPANAN_WAJIB", "5000000000", { entryDate: IN_2025 });

    await checkAuditThreshold(MARCH_2026, admin.user.tenantId);

    const managerRes = await request(app()).get("/api/notifications").set("Authorization", `Bearer ${manager.accessToken}`);
    const viewerRes = await request(app()).get("/api/notifications").set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(managerRes.body.data).toHaveLength(1);
    expect(managerRes.body.data[0].type).toBe("AUDIT_THRESHOLD_EXCEEDED");
    expect(viewerRes.body.data).toHaveLength(0);
  });

  it("runs as part of the daily scheduler", async () => {
    const admin = await setupTenant();
    await postEquity(admin.user.tenantId, "SIMPANAN_WAJIB", "5000000000", { entryDate: IN_2025 });

    const res = await request(app()).post("/api/scheduler/run-daily").set("x-scheduler-token", "test-scheduler-secret");

    expect(res.status).toBe(200);
    expect(res.body.data.auditThreshold).toEqual({ checked: 1, notified: 1, failed: 0 });
    expect(await exceeded(admin.user.tenantId)).toHaveLength(1);
  });
});
