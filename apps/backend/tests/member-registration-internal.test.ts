import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createStaffSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
  vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
});

async function seedRequest(tenantId: string, overrides: Partial<Parameters<typeof db.memberRegistrationRequest.create>[0]["data"]> = {}) {
  return db.memberRegistrationRequest.create({
    data: {
      tenantId,
      fullName: "Budi Santoso",
      nik: "3171234567890001",
      address: "Jl. Kebon Jeruk No. 5, Jakarta Barat",
      birthPlace: "Jakarta",
      birthDate: new Date("1985-03-15"),
      occupation: "Pedagang",
      ...overrides
    }
  });
}

describe("GET /api/members/self-registration-link", () => {
  it("returns the QR URL for a Manager — the seeded role that actually grants members.create (Teller is READ_ONLY on members, see tenants/provision.ts SEED_ROLES)", async () => {
    const admin = await setupTenant();
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");

    const res = await request(app())
      .get("/api/members/self-registration-link")
      .set("Authorization", `Bearer ${manager.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe("https://siskop.example/daftar/demo");
  });

  it("rejects a Viewer — members.create is not granted to that role", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await request(app())
      .get("/api/members/self-registration-link")
      .set("Authorization", `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });
});

describe("GET /api/members/registration-requests", () => {
  it("lists pending requests for the caller's tenant only", async () => {
    const admin = await setupTenant();
    await seedRequest(admin.user.tenantId);

    const res = await request(app())
      .get("/api/members/registration-requests?status=PENDING")
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.meta.total).toBe(1);
  });

  it("rejects a Viewer", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");

    const res = await request(app())
      .get("/api/members/registration-requests")
      .set("Authorization", `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(403);
  });
});

describe("POST /api/members/registration-requests/:id/approve", () => {
  it("creates a Member using the standard ID format and marks the request APPROVED", async () => {
    const admin = await setupTenant();
    const req = await seedRequest(admin.user.tenantId);

    const res = await request(app())
      .post(`/api/members/registration-requests/${req.id}/approve`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.memberId).toMatch(/^KOP-DEMO-\d{6}-\d{4}$/);
    expect(res.body.data.accountNumber).toMatch(/^ACC-\d{10}$/);
    expect(res.body.data.isActive).toBe(true);

    const updated = await db.memberRegistrationRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(updated.status).toBe("APPROVED");
    expect(updated.reviewedByUserId).toBe(admin.user.id);
    expect(updated.reviewedAt).not.toBeNull();
    expect(updated.createdMemberId).toBe(res.body.data.id);
  });

  it("fails with 409 NIK_EXISTS when a Member with this NIK already exists in the tenant", async () => {
    const admin = await setupTenant();
    await request(app())
      .post("/api/members")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({
        fullName: "Existing Member",
        nik: "3171234567890001",
        address: "Jl. Lain No. 1, Jakarta",
        birthPlace: "Jakarta",
        birthDate: "1980-01-01",
        occupation: "Pegawai"
      });
    const pending = await seedRequest(admin.user.tenantId, { nik: "3171234567890001" });

    const res = await request(app())
      .post(`/api/members/registration-requests/${pending.id}/approve`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NIK_EXISTS");

    const updated = await db.memberRegistrationRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(updated.status).toBe("PENDING");
  });

  it("fails with 409 when the request was already reviewed", async () => {
    const admin = await setupTenant();
    const reviewed = await seedRequest(admin.user.tenantId, { status: "REJECTED", rejectionReason: "test" });

    const res = await request(app())
      .post(`/api/members/registration-requests/${reviewed.id}/approve`)
      .set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(409);
  });

  it("rejects a Viewer", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");
    const pending = await seedRequest(admin.user.tenantId);

    const res = await request(app())
      .post(`/api/members/registration-requests/${pending.id}/approve`)
      .set("Authorization", `Bearer ${viewer.accessToken}`);

    expect(res.status).toBe(403);
  });
});

describe("POST /api/members/registration-requests/:id/reject", () => {
  it("marks the request REJECTED with the given reason", async () => {
    const admin = await setupTenant();
    const pending = await seedRequest(admin.user.tenantId);

    const res = await request(app())
      .post(`/api/members/registration-requests/${pending.id}/reject`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ rejectionReason: "Foto KTP tidak jelas" });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("REJECTED");
    expect(res.body.data.rejectionReason).toBe("Foto KTP tidak jelas");
  });

  it("requires a non-empty rejectionReason", async () => {
    const admin = await setupTenant();
    const pending = await seedRequest(admin.user.tenantId);

    const res = await request(app())
      .post(`/api/members/registration-requests/${pending.id}/reject`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ rejectionReason: "" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");

    const updated = await db.memberRegistrationRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(updated.status).toBe("PENDING");
  });

  it("rejects a Viewer", async () => {
    const admin = await setupTenant();
    const viewer = await createStaffSession(admin.user.tenantId, "demo", "Viewer", "viewer@demo.test");
    const pending = await seedRequest(admin.user.tenantId);

    const res = await request(app())
      .post(`/api/members/registration-requests/${pending.id}/reject`)
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ rejectionReason: "test" });

    expect(res.status).toBe(403);
  });
});
