import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { createTenantNotification } from "../src/modules/notifications/service.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("GET /api/notifications", () => {
  it("shows a members.create notification to a Manager but not to a Viewer", async () => {
    const admin = await setupTenant();
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    await createTenantNotification(db, {
      tenantId: admin.user.tenantId,
      type: "MEMBER_REGISTRATION_PENDING",
      title: "Pendaftaran mandiri baru",
      message: "1 pendaftaran mandiri menunggu persetujuan",
      permissionModule: "members",
      permissionAction: "create"
    });

    const managerRes = await request(app()).get("/api/notifications").set("Authorization", `Bearer ${manager.accessToken}`);
    const viewerRes = await request(app()).get("/api/notifications").set("Authorization", `Bearer ${viewer.accessToken}`);

    expect(managerRes.status).toBe(200);
    expect(managerRes.body.data).toHaveLength(1);
    expect(managerRes.body.data[0].message).toBe("1 pendaftaran mandiri menunggu persetujuan");
    expect(managerRes.body.data[0].read).toBe(false);
    expect(managerRes.body.meta.unreadCount).toBe(1);

    expect(viewerRes.status).toBe(200);
    expect(viewerRes.body.data).toHaveLength(0);
    expect(viewerRes.body.meta.unreadCount).toBe(0);
  });

  it("never shows a notification from another tenant", async () => {
    const tenantA = await setupTenant({ slug: "demo" });
    const tenantB = await setupTenant({ slug: "demo2", registrationNo: "KOP-DEMO2" });

    await createTenantNotification(db, {
      tenantId: tenantB.user.tenantId,
      type: "MEMBER_REGISTRATION_PENDING",
      title: "Pendaftaran mandiri baru",
      message: "1 pendaftaran mandiri menunggu persetujuan",
      permissionModule: "members",
      permissionAction: "create"
    });

    const res = await request(app()).get("/api/notifications").set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.body.data).toHaveLength(0);
  });
});

describe("POST /api/notifications/:id/read", () => {
  it("marks a notification read for that user only, and unreadCount drops", async () => {
    const admin = await setupTenant();
    const notification = await createTenantNotification(db, {
      tenantId: admin.user.tenantId,
      type: "MEMBER_REGISTRATION_PENDING",
      title: "Pendaftaran mandiri baru",
      message: "1 pendaftaran mandiri menunggu persetujuan",
      permissionModule: "members",
      permissionAction: "create"
    });

    const markRes = await request(app())
      .post(`/api/notifications/${notification.id}/read`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(markRes.status).toBe(200);

    const listRes = await request(app()).get("/api/notifications").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(listRes.body.data[0].read).toBe(true);
    expect(listRes.body.meta.unreadCount).toBe(0);
  });

  it("is idempotent — marking an already-read notification read again does not error", async () => {
    const admin = await setupTenant();
    const notification = await createTenantNotification(db, {
      tenantId: admin.user.tenantId,
      type: "MEMBER_REGISTRATION_PENDING",
      title: "t",
      message: "m",
      permissionModule: "members",
      permissionAction: "create"
    });

    await request(app()).post(`/api/notifications/${notification.id}/read`).set("Authorization", `Bearer ${admin.accessToken}`);
    const second = await request(app())
      .post(`/api/notifications/${notification.id}/read`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(second.status).toBe(200);
  });

  it("404s for a notification belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "demo" });
    const tenantB = await setupTenant({ slug: "demo2", registrationNo: "KOP-DEMO2" });
    const notification = await createTenantNotification(db, {
      tenantId: tenantB.user.tenantId,
      type: "MEMBER_REGISTRATION_PENDING",
      title: "t",
      message: "m",
      permissionModule: "members",
      permissionAction: "create"
    });

    const res = await request(app())
      .post(`/api/notifications/${notification.id}/read`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`);

    expect(res.status).toBe(404);
  });
});
