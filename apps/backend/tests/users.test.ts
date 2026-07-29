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

describe("GET/POST/PUT /api/users", () => {
  it("lists the tenant's users, including the admin auto-created at registration", async () => {
    const admin = await setupTenant();
    const res = await request(app()).get("/api/users").set("Authorization", `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe("admin@demo.test");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
    expect(JSON.stringify(res.body)).not.toContain("$2");
  });

  it("creates a new staff user under an existing role", async () => {
    const admin = await setupTenant();
    const tellerRole = await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Teller" } });

    const res = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Teller Baru", email: "teller-baru@demo.test", password: "rahasia123", roleId: tellerRole.id });

    expect(res.status).toBe(201);
    expect(res.body.data.email).toBe("teller-baru@demo.test");
    expect(res.body.data.roleName).toBe("Teller");
    expect(res.body.data.isActive).toBe(true);

    const login = await request(app())
      .post("/api/auth/login")
      .set("Host", "demo.localhost")
      .send({ email: "teller-baru@demo.test", password: "rahasia123" });
    expect(login.status).toBe(200);
  });

  it("rejects a duplicate email within the same tenant", async () => {
    const admin = await setupTenant();
    const tellerRole = await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Teller" } });

    const res = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Dup", email: "admin@demo.test", password: "rahasia123", roleId: tellerRole.id });

    expect(res.status).toBe(409);
  });

  it("rejects a roleId belonging to another tenant", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });
    const roleB = await db.role.findFirstOrThrow({ where: { tenantId: tenantB.user.tenantId, name: "Teller" } });

    const res = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ name: "Hijack", email: "hijack@demo.test", password: "rahasia123", roleId: roleB.id });

    expect(res.status).toBe(404);
  });

  it("updates a user's name, email, and role", async () => {
    const admin = await setupTenant();
    const managerRole = await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Manager" } });
    const tellerRole = await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Teller" } });
    const created = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Teller Baru", email: "teller-baru@demo.test", password: "rahasia123", roleId: tellerRole.id });

    const res = await request(app())
      .put(`/api/users/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Manager Baru", email: "manager-baru@demo.test", roleId: managerRole.id });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Manager Baru");
    expect(res.body.data.roleName).toBe("Manager");
  });

  it("deactivates and reactivates a user", async () => {
    const admin = await setupTenant();
    const tellerRole = await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Teller" } });
    const created = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Teller Baru", email: "teller-baru@demo.test", password: "rahasia123", roleId: tellerRole.id });

    const deactivated = await request(app())
      .put(`/api/users/${created.body.data.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);

    const blockedLogin = await request(app())
      .post("/api/auth/login")
      .set("Host", "demo.localhost")
      .send({ email: "teller-baru@demo.test", password: "rahasia123" });
    expect(blockedLogin.status).toBe(401);
  });

  it("rejects deactivating your own account", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .put(`/api/users/${admin.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });

    expect(res.status).toBe(409);
  });

  it("rejects a Teller — users.create is not granted to that role", async () => {
    const admin = await setupTenant();
    const teller = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");
    const tellerRole = await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Teller" } });

    const res = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${teller.accessToken}`)
      .send({ name: "X", email: "x@demo.test", password: "rahasia123", roleId: tellerRole.id });

    expect(res.status).toBe(403);
  });

  it("lets a Manager list users but not create one — Manager only has users.read", async () => {
    const admin = await setupTenant();
    const manager = await createStaffSession(admin.user.tenantId, "demo", "Manager", "manager@demo.test");

    const list = await request(app()).get("/api/users").set("Authorization", `Bearer ${manager.accessToken}`);
    expect(list.status).toBe(200);

    const tellerRole = await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Teller" } });
    const created = await request(app())
      .post("/api/users")
      .set("Authorization", `Bearer ${manager.accessToken}`)
      .send({ name: "X", email: "x@demo.test", password: "rahasia123", roleId: tellerRole.id });
    expect(created.status).toBe(403);
  });

  it("cannot update another tenant's user", async () => {
    const tenantA = await setupTenant({ slug: "tenant-a", registrationNo: "KOP-A" });
    const tenantB = await setupTenant({ slug: "tenant-b", registrationNo: "KOP-B" });

    const res = await request(app())
      .put(`/api/users/${tenantB.user.id}`)
      .set("Authorization", `Bearer ${tenantA.accessToken}`)
      .send({ name: "Hijack" });

    expect(res.status).toBe(404);
  });
});

// ── Profile self-service ──────────────────────────────────────────────────────

describe("PUT /api/auth/me", () => {
  it("updates the caller's own name and email", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .put("/api/auth/me")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Admin Baru", email: "admin-baru@demo.test" });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Admin Baru");
    expect(res.body.data.email).toBe("admin-baru@demo.test");
  });

  it("rejects an email already used by another user in the same tenant", async () => {
    const admin = await setupTenant();
    await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller@demo.test");

    const res = await request(app())
      .put("/api/auth/me")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Admin", email: "teller@demo.test" });

    expect(res.status).toBe(409);
  });
});

describe("PUT /api/auth/me/password", () => {
  it("changes the password when the current password is correct", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .put("/api/auth/me/password")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ currentPassword: "rahasia123", newPassword: "passwordBaru123" });
    expect(res.status).toBe(200);

    const login = await request(app())
      .post("/api/auth/login")
      .set("Host", "demo.localhost")
      .send({ email: "admin@demo.test", password: "passwordBaru123" });
    expect(login.status).toBe(200);
  });

  it("rejects when the current password is wrong", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .put("/api/auth/me/password")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ currentPassword: "salah", newPassword: "passwordBaru123" });

    expect(res.status).toBe(401);
  });

  it("rejects a new password shorter than 8 characters", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .put("/api/auth/me/password")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ currentPassword: "rahasia123", newPassword: "short" });

    expect(res.status).toBe(422);
  });
});
