import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("GET /api/config/self-registration", () => {
  it("defaults to enabled for a freshly-provisioned tenant", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .get("/api/config/self-registration")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.selfRegistrationEnabled).toBe(true);
  });
});

describe("PUT /api/config/self-registration", () => {
  it("toggles the flag for a Super Admin", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .put("/api/config/self-registration")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ selfRegistrationEnabled: false });

    expect(res.status).toBe(200);
    expect(res.body.data.selfRegistrationEnabled).toBe(false);

    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: admin.user.tenantId } });
    expect(tenant.selfRegistrationEnabled).toBe(false);
  });

  it("rejects a Manager — config.update is Super-Admin-only, same as modal-disetor/whitelabel", async () => {
    const admin = await setupTenant();
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");

    const res = await request(app())
      .put("/api/config/self-registration")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ selfRegistrationEnabled: false });

    expect(res.status).toBe(403);
  });
});
