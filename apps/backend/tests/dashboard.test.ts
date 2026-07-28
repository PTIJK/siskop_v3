import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createMemberWithPokokSaving, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("GET /api/dashboard/summary", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app()).get("/api/dashboard/summary");
    expect(res.status).toBe(401);
  });

  it("returns aggregate stats reflecting created members/savings", async () => {
    const admin = await setupTenant();
    await createMemberWithPokokSaving(admin.accessToken);

    const res = await request(app())
      .get("/api/dashboard/summary")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.memberCount).toBe(1);
    expect(res.body.data.totalSavings).toBe("500000");
    expect(res.body.data.overdueCount).toBe(0);
  });

  it("lets a teller read the summary", async () => {
    const admin = await setupTenant();
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .get("/api/dashboard/summary")
      .set("Authorization", `Bearer ${teller.accessToken}`);

    expect(res.status).toBe(200);
  });
});

describe("GET /api/dashboard/loan-chart", () => {
  it("returns one point per requested month", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .get("/api/dashboard/loan-chart?months=3")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data[0]).toHaveProperty("month");
    expect(res.body.data[0]).toHaveProperty("value");
  });
});

describe("GET /api/dashboard/payment-chart", () => {
  it("returns one point per requested month", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .get("/api/dashboard/payment-chart?months=6")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(6);
  });
});
