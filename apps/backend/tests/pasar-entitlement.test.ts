import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

describe("koperasi pasar (Market + Collections) package entitlement — D6", () => {
  it("403s GET /api/market/markets for a tenant with no package", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const res = await request(app()).get("/api/market/markets").set(bearer(admin.accessToken));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("403s GET /api/collections/today for a tenant with no package", async () => {
    const admin = await setupTenant({}, { entitled: false });

    const res = await request(app()).get("/api/collections/today").set(bearer(admin.accessToken));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("403s a tenant whose package has other modules but not pasar", async () => {
    const admin = await setupTenant();
    const pkg = await db.subscriptionPackage.create({
      data: { name: "Akuntansi Saja", price: 0, modules: ["accounting"], maxUsers: 10, maxMembers: 100, isActive: true }
    });
    await db.tenant.update({ where: { id: admin.user.tenantId }, data: { packageId: pkg.id } });

    const res = await request(app()).get("/api/market/markets").set(bearer(admin.accessToken));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FEATURE_NOT_ENTITLED");
  });

  it("allows a tenant whose package includes pasar", async () => {
    const admin = await setupTenant();
    const pkg = await db.subscriptionPackage.create({
      data: { name: "Paket Pasar", price: 0, modules: ["pasar"], maxUsers: 10, maxMembers: 100, isActive: true }
    });
    await db.tenant.update({ where: { id: admin.user.tenantId }, data: { packageId: pkg.id } });

    const market = await request(app()).get("/api/market/markets").set(bearer(admin.accessToken));
    const collections = await request(app()).get("/api/collections/today").set(bearer(admin.accessToken));

    expect(market.status).toBe(200);
    expect(collections.status).toBe(200);
  });
});
