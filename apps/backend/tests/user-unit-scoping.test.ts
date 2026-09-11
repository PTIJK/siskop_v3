import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

/**
 * Part 2 of the Kasir (Toko-only) feature — per-user unit scoping. Backed by
 * the new UserUnit table (see lib/unit-access.ts). Every konsumen route
 * checks `assertUnitAccess` now, so these prove the *specific unit* a user
 * was assigned is what's enforced, not just "has konsumen permission" (that
 * axis is already covered by tests/konsumen-routes.test.ts's Kasir tests).
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

async function createUnit(accessToken: string, type: string, name: string) {
  const res = await request(app())
    .post("/api/config/units")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ type, name });
  return res.body.data as { id: string; name: string };
}

async function kasirRoleId(tenantId: string): Promise<string> {
  const role = await db.role.findFirstOrThrow({ where: { tenantId, name: "Kasir" } });
  return role.id;
}

describe("POST /api/users — unitIds validation", () => {
  it("rejects a body with no unitIds", async () => {
    const admin = await setupTenant();
    const roleId = await kasirRoleId(admin.user.tenantId);

    const res = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Kasir Toko", email: "kasir@demo.test", password: "rahasia123", roleId });

    expect(res.status).toBe(422);
  });

  it("rejects an empty unitIds array", async () => {
    const admin = await setupTenant();
    const roleId = await kasirRoleId(admin.user.tenantId);

    const res = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Kasir Toko", email: "kasir@demo.test", password: "rahasia123", roleId, unitIds: [] });

    expect(res.status).toBe(422);
  });

  it("rejects a unitId belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const roleId = await kasirRoleId(tenantA.user.tenantId);
    const unitB = await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: tenantB.user.tenantId } });

    const res = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({
        name: "Hijack",
        email: "hijack@demo.test",
        password: "rahasia123",
        roleId,
        unitIds: [unitB.id]
      });

    expect(res.status).toBe(422);

    const created = await db.user.findFirst({ where: { tenantId: tenantA.user.tenantId, email: "hijack@demo.test" } });
    expect(created).toBeNull();
  });

  it("creates a user scoped to exactly the given units, reflected in the response's unitIds", async () => {
    const admin = await setupTenant();
    const roleId = await kasirRoleId(admin.user.tenantId);
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");

    const res = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        name: "Kasir Toko",
        email: "kasir@demo.test",
        password: "rahasia123",
        roleId,
        unitIds: [tokoUnit.id]
      });

    expect(res.status).toBe(201);
    expect(res.body.data.unitIds).toEqual([tokoUnit.id]);
  });
});

describe("Kasir unit scoping — the specific assigned unit is what's enforced", () => {
  it("can act on its own Toko unit but gets 403 on a second Toko unit it was never assigned", async () => {
    const admin = await setupTenant();
    const roleId = await kasirRoleId(admin.user.tenantId);
    const tokoA = await createUnit(admin.accessToken, "KONSUMEN", "Toko A");
    const tokoB = await createUnit(admin.accessToken, "KONSUMEN", "Toko B");

    const created = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        name: "Kasir Toko A",
        email: "kasir-a@demo.test",
        password: "rahasia123",
        roleId,
        unitIds: [tokoA.id]
      });

    const login = await request(app())
      .post("/api/auth/login")
      .set("Host", "demo.localhost")
      .send({ email: "kasir-a@demo.test", password: "rahasia123" });
    const kasirToken = login.body.data.accessToken as string;

    const allowed = await request(app())
      .get(`/api/konsumen/products?unitId=${tokoA.id}`)
      .set("Authorization", `Bearer ${kasirToken}`);
    expect(allowed.status).toBe(200);

    const denied = await request(app())
      .get(`/api/konsumen/products?unitId=${tokoB.id}`)
      .set("Authorization", `Bearer ${kasirToken}`);
    expect(denied.status).toBe(403);

    expect(created.status).toBe(201);
  });

  it("a user with zero explicit UserUnit rows (createStaffSession) still reaches every active unit — the fallback preserves pre-scoping behavior", async () => {
    const admin = await setupTenant();
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir-fallback@demo.test");

    const res = await request(app())
      .get(`/api/konsumen/products?unitId=${tokoUnit.id}`)
      .set("Authorization", `Bearer ${kasir.accessToken}`);

    expect(res.status).toBe(200);
  });
});

describe("PUT /api/users/:id — replacing unitIds takes effect immediately", () => {
  it("a fresh request (no re-login) sees the updated scope, since checks are DB-backed, not JWT-cached", async () => {
    const admin = await setupTenant();
    const roleId = await kasirRoleId(admin.user.tenantId);
    const tokoA = await createUnit(admin.accessToken, "KONSUMEN", "Toko A");
    const tokoB = await createUnit(admin.accessToken, "KONSUMEN", "Toko B");

    const created = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        name: "Kasir Toko A",
        email: "kasir-move@demo.test",
        password: "rahasia123",
        roleId,
        unitIds: [tokoA.id]
      });

    const login = await request(app())
      .post("/api/auth/login")
      .set("Host", "demo.localhost")
      .send({ email: "kasir-move@demo.test", password: "rahasia123" });
    const kasirToken = login.body.data.accessToken as string;

    const beforeMove = await request(app())
      .get(`/api/konsumen/products?unitId=${tokoB.id}`)
      .set("Authorization", `Bearer ${kasirToken}`);
    expect(beforeMove.status).toBe(403);

    await request(app())
      .put(`/api/users/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitIds: [tokoB.id] });

    // Same access token as before, no refresh — proves enforcement is a
    // fresh DB lookup per request, not the stale JWT unitIds claim.
    const afterMove = await request(app())
      .get(`/api/konsumen/products?unitId=${tokoB.id}`)
      .set("Authorization", `Bearer ${kasirToken}`);
    expect(afterMove.status).toBe(200);

    const nowDenied = await request(app())
      .get(`/api/konsumen/products?unitId=${tokoA.id}`)
      .set("Authorization", `Bearer ${kasirToken}`);
    expect(nowDenied.status).toBe(403);
  });

  it("rejects replacing unitIds with an empty array", async () => {
    const admin = await setupTenant();
    const roleId = await kasirRoleId(admin.user.tenantId);
    const tokoUnit = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const created = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        name: "Kasir Toko",
        email: "kasir-empty@demo.test",
        password: "rahasia123",
        roleId,
        unitIds: [tokoUnit.id]
      });

    const res = await request(app())
      .put(`/api/users/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ unitIds: [] });

    expect(res.status).toBe(422);
  });
});
