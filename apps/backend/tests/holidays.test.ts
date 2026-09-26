import { describe, it, expect, beforeAll, beforeEach } from "vitest";
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

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("/api/config/holidays", () => {
  it("creates, lists by year and deletes a tenant holiday", async () => {
    const admin = await setupTenant();

    const created = await request(app())
      .post("/api/config/holidays")
      .set(bearer(admin.accessToken))
      .send({ date: "2026-12-25", name: "Hari Raya Natal" });
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ date: "2026-12-25", name: "Hari Raya Natal" });

    await request(app())
      .post("/api/config/holidays")
      .set(bearer(admin.accessToken))
      .send({ date: "2027-01-01", name: "Tahun Baru" });

    const list = await request(app()).get("/api/config/holidays?year=2026").set(bearer(admin.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data.map((h: { date: string }) => h.date)).toEqual(["2026-12-25"]);

    const del = await request(app())
      .delete(`/api/config/holidays/${created.body.data.id}`)
      .set(bearer(admin.accessToken));
    expect(del.status).toBe(200);
    const after = await request(app()).get("/api/config/holidays?year=2026").set(bearer(admin.accessToken));
    expect(after.body.data).toEqual([]);
  });

  it("rejects a duplicate date with CONFLICT", async () => {
    const admin = await setupTenant();
    const body = { date: "2026-12-25", name: "Natal" };
    await request(app()).post("/api/config/holidays").set(bearer(admin.accessToken)).send(body);

    const res = await request(app()).post("/api/config/holidays").set(bearer(admin.accessToken)).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONFLICT");
  });

  it("rejects an invalid date", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .post("/api/config/holidays")
      .set(bearer(admin.accessToken))
      .send({ date: "2026-02-30", name: "Tidak ada" });
    expect(res.status).toBe(422);
  });

  it("imports a list of holidays, skipping dates that already exist", async () => {
    const admin = await setupTenant();
    await request(app())
      .post("/api/config/holidays")
      .set(bearer(admin.accessToken))
      .send({ date: "2026-12-25", name: "Natal" });

    const res = await request(app())
      .post("/api/config/holidays/import")
      .set(bearer(admin.accessToken))
      .send({
        holidays: [
          { date: "2026-12-25", name: "Natal" },
          { date: "2026-08-17", name: "HUT RI" }
        ]
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ created: 1, skipped: 1 });
  });

  it("isolates tenants: another tenant cannot see or delete my holidays", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({
      slug: "tenant-b",
      registrationNo: "KOP-B",
      adminEmail: "admin@b.test"
    });
    const created = await request(app())
      .post("/api/config/holidays")
      .set(bearer(tenantA.accessToken))
      .send({ date: "2026-12-25", name: "Natal" });

    const list = await request(app()).get("/api/config/holidays?year=2026").set(bearer(tenantB.accessToken));
    expect(list.body.data).toEqual([]);

    const del = await request(app())
      .delete(`/api/config/holidays/${created.body.data.id}`)
      .set(bearer(tenantB.accessToken));
    expect(del.status).toBe(404);
  });

  it("forbids a Viewer from adding a holiday", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");
    const res = await request(app())
      .post("/api/config/holidays")
      .set(bearer(viewer.accessToken))
      .send({ date: "2026-12-25", name: "Natal" });
    expect(res.status).toBe(403);
  });

  it("writes an audit log entry for each change", async () => {
    const admin = await setupTenant();
    await request(app())
      .post("/api/config/holidays")
      .set(bearer(admin.accessToken))
      .send({ date: "2026-12-25", name: "Natal" });

    const logs = await db.auditLog.findMany({ where: { tenantId: admin.user.tenantId, action: "holiday.create" } });
    expect(logs).toHaveLength(1);
  });
});

describe("/api/config/operating-days", () => {
  it("defaults to Sunday closed and can be changed", async () => {
    const admin = await setupTenant();

    const initial = await request(app()).get("/api/config/operating-days").set(bearer(admin.accessToken));
    expect(initial.status).toBe(200);
    expect(initial.body.data).toEqual({ closedWeekdays: [0] });

    const updated = await request(app())
      .put("/api/config/operating-days")
      .set(bearer(admin.accessToken))
      .send({ closedWeekdays: [5, 0, 0] });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toEqual({ closedWeekdays: [0, 5] });
  });

  it("rejects closing every day of the week", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .put("/api/config/operating-days")
      .set(bearer(admin.accessToken))
      .send({ closedWeekdays: [0, 1, 2, 3, 4, 5, 6] });
    expect(res.status).toBe(422);
  });
});
