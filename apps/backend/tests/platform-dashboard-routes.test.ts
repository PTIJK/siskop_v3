import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("GET /api/platform/dashboard", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app()).get("/api/platform/dashboard");
    expect(res.status).toBe(401);
  });

  it("rejects a regular tenant admin", async () => {
    const admin = await setupTenant();
    const res = await request(app()).get("/api/platform/dashboard").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("returns every section for a platform admin, defaulting to 30d", async () => {
    const session = await createPlatformAdminSession();
    const res = await request(app()).get("/api/platform/dashboard").set("Authorization", `Bearer ${session.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.range).toBe("30d");
    expect(d.growth).toHaveLength(30);
    expect(d.performance.activity).toHaveLength(30);
    expect(d.performance.technical).toHaveLength(30);
    expect(d.members.series).toHaveLength(30);
    expect(d.revenue.series).toHaveLength(12);
    expect(d.kpis.tenants).toBe(1);
    expect(d.kpis.users).toBe(1);
    expect(Array.isArray(d.regions)).toBe(true);
    expect(Array.isArray(d.attention)).toBe(true);
    expect(typeof d.kpis.mrr).toBe("string");
  });

  it("switches to monthly buckets for 12m", async () => {
    const session = await createPlatformAdminSession();
    const res = await request(app()).get("/api/platform/dashboard?range=12m").set("Authorization", `Bearer ${session.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.growth).toHaveLength(12);
  });

  it("rejects an unknown range", async () => {
    const session = await createPlatformAdminSession();
    const res = await request(app()).get("/api/platform/dashboard?range=5y").set("Authorization", `Bearer ${session.accessToken}`);
    expect(res.status).toBe(422);
  });
});
