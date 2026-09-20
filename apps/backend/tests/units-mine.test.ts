import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

/**
 * GET /api/config/units/mine — "which units may I open?". A Kasir (Toko-only,
 * `config: {}`) has no config.read, so /config/units answers 403 and every
 * Toko screen that needed the unit list ("Unit usaha tidak ditemukan") was
 * unreachable for them. This endpoint answers from the caller's own unit
 * assignment instead, so it needs no module permission.
 */

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const bearer = (accessToken: string) => ({ Authorization: `Bearer ${accessToken}` });

async function createUnit(accessToken: string, type: string, name: string) {
  const res = await request(app()).post("/api/config/units").set(bearer(accessToken)).send({ type, name });
  return res.body.data as { id: string; name: string };
}

const mine = (accessToken: string) => request(app()).get("/api/config/units/mine").set(bearer(accessToken));

describe("GET /api/config/units/mine", () => {
  it("returns every unit of the tenant — closed ones too — for a user with no explicit unit assignment", async () => {
    const admin = await setupTenant();
    const tokoA = await createUnit(admin.accessToken, "KONSUMEN", "Toko A");
    const tokoB = await createUnit(admin.accessToken, "KONSUMEN", "Toko B");
    await request(app()).put(`/api/config/units/${tokoB.id}`).set(bearer(admin.accessToken)).send({ isActive: false });

    const res = await mine(admin.accessToken);

    expect(res.status).toBe(200);
    const units = res.body.data as Array<{ id: string; type: string; isActive: boolean }>;
    expect(units.map((u) => u.id).sort()).toEqual(
      (await db.cooperativeUnit.findMany({ where: { tenantId: admin.user.tenantId } })).map((u) => u.id).sort()
    );
    expect(units.find((u) => u.id === tokoA.id)?.type).toBe("KONSUMEN");
    expect(units.find((u) => u.id === tokoB.id)?.isActive).toBe(false);
  });

  it("gives a Kasir the unit list even though /config/units is forbidden to them", async () => {
    const admin = await setupTenant();
    const toko = await createUnit(admin.accessToken, "KONSUMEN", "Toko Koperasi");
    const kasir = await createStaffSession(admin.user.tenantId, "demo", "Kasir", "kasir@demo.test");
    await db.userUnit.create({ data: { userId: kasir.user.id, unitId: toko.id } });

    expect((await request(app()).get("/api/config/units").set(bearer(kasir.accessToken))).status).toBe(403);

    const res = await mine(kasir.accessToken);
    expect(res.status).toBe(200);
    expect((res.body.data as Array<{ id: string }>).map((u) => u.id)).toEqual([toko.id]);
  });

  it("returns only the assigned units for a scoped user, not the rest of the tenant", async () => {
    const admin = await setupTenant();
    const tokoA = await createUnit(admin.accessToken, "KONSUMEN", "Toko A");
    await createUnit(admin.accessToken, "KONSUMEN", "Toko B");
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");
    await db.userUnit.create({ data: { userId: manager.user.id, unitId: tokoA.id } });

    const res = await mine(manager.accessToken);

    expect((res.body.data as Array<{ id: string }>).map((u) => u.id)).toEqual([tokoA.id]);
  });

  it("never lists another tenant's units", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const tokoB = await createUnit(tenantB.accessToken, "KONSUMEN", "Toko B");

    const res = await mine(tenantA.accessToken);

    expect((res.body.data as Array<{ id: string }>).map((u) => u.id)).not.toContain(tokoB.id);
  });

  it("requires authentication", async () => {
    const res = await request(app()).get("/api/config/units/mine");
    expect(res.status).toBe(401);
  });
});
