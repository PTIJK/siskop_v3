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

const MEMBER = {
  fullName: "Budi Santoso",
  nik: "3171234567890001",
  address: "Jl. Kebon Jeruk No. 5, Jakarta Barat",
  birthPlace: "Jakarta",
  birthDate: "1985-03-15",
  occupation: "Pedagang"
};

describe("passwordHash never reaches the wire", () => {
  it("is absent from create/list/get responses, even after portal access is activated", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);
    expect(JSON.stringify(created.body)).not.toContain("passwordHash");

    await request(app())
      .post(`/api/members/${created.body.data.id}/portal-access`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send();

    const list = await request(app()).get("/api/members").set("Authorization", `Bearer ${admin.accessToken}`);
    expect(JSON.stringify(list.body)).not.toContain("passwordHash");
    expect(JSON.stringify(list.body)).not.toMatch(/\$2[aby]\$/);

    const detail = await request(app())
      .get(`/api/members/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(JSON.stringify(detail.body)).not.toContain("passwordHash");
    expect(JSON.stringify(detail.body)).not.toMatch(/\$2[aby]\$/);
  });
});

describe("POST /api/members", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app()).post("/api/members").send(MEMBER);
    expect(res.status).toBe(401);
  });

  it("rejects a teller — members.create is not granted to that role", async () => {
    const admin = await setupTenant();
    const teller = await createStaffSession(
      admin.user.tenantId,
      "demo",
      "Teller",
      "teller@demo.test"
    );

    const res = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .send(MEMBER);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("creates a member with an auto-generated memberId and accountNumber", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);

    expect(res.status).toBe(201);
    expect(res.body.data.fullName).toBe("Budi Santoso");
    expect(res.body.data.memberId).toMatch(/^KOP-DEMO-\d{6}-0001$/);
    expect(res.body.data.accountNumber).toMatch(/^ACC-\d{10}$/);
    expect(res.body.data.isActive).toBe(true);
  });

  // Auto-enrollment: no unit-picker UI in Phase 1, member joins the tenant's
  // sole unit invisibly (CLAUDE.md rule 2b / merge plan "unit scoping").
  it("auto-enrolls the new member into the tenant's sole unit", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);

    const membership = await db.unitMembership.findFirst({
      where: { memberId: res.body.data.id }
    });
    expect(membership).not.toBeNull();
  });

  it("rejects a duplicate NIK within the same tenant with 409", async () => {
    const admin = await setupTenant();
    await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);

    const res = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...MEMBER, fullName: "Someone Else" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NIK_EXISTS");
  });

  it("rejects missing required fields with 422", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ fullName: "Budi" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("GET /api/members", () => {
  it("returns a paginated list with meta", async () => {
    const admin = await setupTenant();
    await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);

    const res = await request(app())
      .get("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 1 });
  });

  it("filters by a search keyword", async () => {
    const admin = await setupTenant();
    await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);
    await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ ...MEMBER, fullName: "Siti Rahayu", nik: "3171234567890002" });

    const res = await request(app())
      .get("/api/members?search=Siti")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].fullName).toBe("Siti Rahayu");
  });

  it("lets a teller read the list", async () => {
    const admin = await setupTenant();
    const teller = await createStaffSession(
      admin.user.tenantId,
      "demo",
      "Teller",
      "teller@demo.test"
    );

    const res = await request(app())
      .get("/api/members")
      .set("Authorization", `Bearer ${teller.accessToken}`);

    expect(res.status).toBe(200);
  });
});

describe("GET /api/members/:id", () => {
  it("returns member detail including empty savings/loans arrays", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);

    const res = await request(app())
      .get(`/api/members/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.savings).toEqual([]);
    expect(res.body.data.loans).toEqual([]);
  });

  it("returns 404 for a nonexistent id", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/members/does-not-exist")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/members/:id", () => {
  it("updates the occupation field", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);

    const res = await request(app())
      .put(`/api/members/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ occupation: "Wiraswasta" });

    expect(res.status).toBe(200);
    expect(res.body.data.occupation).toBe("Wiraswasta");
  });

  it("rejects a teller — members.update is not granted to that role", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);
    const teller = await createStaffSession(
      admin.user.tenantId,
      "demo",
      "Teller",
      "teller@demo.test"
    );

    const res = await request(app())
      .put(`/api/members/${created.body.data.id}`)
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .send({ occupation: "Wiraswasta" });

    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/members/:id", () => {
  it("rejects a teller — members.delete is not granted to that role", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);
    const teller = await createStaffSession(
      admin.user.tenantId,
      "demo",
      "Teller",
      "teller@demo.test"
    );

    const res = await request(app())
      .delete(`/api/members/${created.body.data.id}`)
      .set("Authorization", `Bearer ${teller.accessToken}`);

    expect(res.status).toBe(403);
  });

  it("soft-deletes — sets isActive false rather than removing the row", async () => {
    const admin = await setupTenant();
    const created = await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(MEMBER);

    const res = await request(app())
      .delete(`/api/members/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);

    const member = await db.member.findUnique({ where: { id: created.body.data.id } });
    expect(member).not.toBeNull();
    expect(member?.isActive).toBe(false);
  });
});
