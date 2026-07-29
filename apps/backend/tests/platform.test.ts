import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import request from "supertest";
import { db } from "../src/lib/db.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

const NEW_TENANT = {
  tenantName: "KSP Baru",
  slug: "baru",
  registrationNo: "KOP-BARU",
  address: "Jl. Baru 1",
  type: "KONVENSIONAL" as const,
  adminName: "Admin Baru",
  adminEmail: "admin@baru.test",
  adminPassword: "rahasia123",
  firstUnit: { type: "KSP" as const, name: "Simpan Pinjam" }
};

describe("GET /api/platform/tenants", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await request(app()).get("/api/platform/tenants");
    expect(res.status).toBe(401);
  });

  it("rejects a regular tenant admin — not a platform admin", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/platform/tenants")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("lists every tenant on the platform with unit and user counts", async () => {
    const platformAdmin = await createPlatformAdminSession();
    await setupTenant({ slug: "kedua", registrationNo: "KOP-002" });

    const res = await request(app())
      .get("/api/platform/tenants")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((t: { slug: string }) => t.slug).sort()).toEqual(["demo", "kedua"]);

    const demo = res.body.data.find((t: { slug: string }) => t.slug === "demo");
    expect(demo.unitCount).toBe(1);
    // admin@demo.test (from setupTenant) + platform-admin@demo.test.
    expect(demo.userCount).toBe(2);
  });
});

describe("POST /api/platform/tenants", () => {
  it("provisions a new koperasi with a working admin login", async () => {
    const platformAdmin = await createPlatformAdminSession();

    const res = await request(app())
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send(NEW_TENANT);

    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe("baru");

    const units = await db.cooperativeUnit.findMany({ where: { tenant: { slug: "baru" } } });
    expect(units).toHaveLength(1);

    const newAdminLogin = await request(app())
      .post("/api/auth/login")
      .set("Host", "baru.localhost")
      .send({ email: NEW_TENANT.adminEmail, password: NEW_TENANT.adminPassword });
    expect(newAdminLogin.status).toBe(200);
  });

  it("rejects a duplicate slug", async () => {
    const platformAdmin = await createPlatformAdminSession();

    const res = await request(app())
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ ...NEW_TENANT, slug: "demo" });

    expect(res.status).toBe(409);
  });

  it("rejects a regular tenant admin — not a platform admin", async () => {
    const admin = await setupTenant();

    const res = await request(app())
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(NEW_TENANT);

    expect(res.status).toBe(403);
  });

  it("rejects an invalid slug", async () => {
    const platformAdmin = await createPlatformAdminSession();

    const res = await request(app())
      .post("/api/platform/tenants")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ ...NEW_TENANT, slug: "Not A Valid Slug" });

    expect(res.status).toBe(422);
  });
});

describe("PUT /api/platform/tenants/:id", () => {
  it("assigns a package and toggles active status", async () => {
    const platformAdmin = await createPlatformAdminSession();
    const tenantAdmin = await setupTenant({ slug: "tenant-manage", registrationNo: "KOP-MANAGE" }, { entitled: false });
    const pkg = await request(app())
      .post("/api/platform/packages")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ name: "Paket Dasar", price: 100000, modules: [], maxUsers: 5, maxMembers: 100 });

    const res = await request(app())
      .put(`/api/platform/tenants/${tenantAdmin.user.tenantId}`)
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ packageId: pkg.body.data.id, isActive: false, nextBillingDate: "2027-01-01" });

    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);

    const stored = await db.tenant.findUniqueOrThrow({ where: { id: tenantAdmin.user.tenantId } });
    expect(stored.packageId).toBe(pkg.body.data.id);
  });

  it("rejects a non-platform-admin", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .put(`/api/platform/tenants/${admin.user.tenantId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(403);
  });

  it("404s for an unknown tenant", async () => {
    const platformAdmin = await createPlatformAdminSession();
    const res = await request(app())
      .put("/api/platform/tenants/nonexistent")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ isActive: false });
    expect(res.status).toBe(404);
  });
});

describe("GET/POST/PUT/DELETE /api/platform/packages", () => {
  const NEW_PACKAGE = {
    name: "Paket Lengkap",
    price: 500000,
    modules: ["accounting"] as const,
    maxUsers: 20,
    maxMembers: 500,
    whitelabelEnabled: true
  };

  it("creates, lists, updates, and deactivates a package", async () => {
    const platformAdmin = await createPlatformAdminSession();

    const created = await request(app())
      .post("/api/platform/packages")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send(NEW_PACKAGE);
    expect(created.status).toBe(201);
    expect(created.body.data.modules).toEqual(["accounting"]);

    const list = await request(app())
      .get("/api/platform/packages")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`);
    expect(list.body.data.map((p: { name: string }) => p.name)).toContain("Paket Lengkap");

    const updated = await request(app())
      .put(`/api/platform/packages/${created.body.data.id}`)
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ maxUsers: 50 });
    expect(updated.status).toBe(200);
    expect(updated.body.data.maxUsers).toBe(50);

    const deactivated = await request(app())
      .delete(`/api/platform/packages/${created.body.data.id}`)
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`);
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.isActive).toBe(false);
  });

  it("rejects a non-platform-admin", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .post("/api/platform/packages")
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send(NEW_PACKAGE);
    expect(res.status).toBe(403);
  });

  it("404s updating an unknown package", async () => {
    const platformAdmin = await createPlatformAdminSession();
    const res = await request(app())
      .put("/api/platform/packages/nonexistent")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ maxUsers: 10 });
    expect(res.status).toBe(404);
  });
});

describe("GET/POST/PUT/DELETE /api/platform/admins", () => {
  const NEW_ADMIN = { name: "Admin Baru", email: "admin-baru@siskop.test", password: "Rahasia123" };

  it("creates, lists, and updates a platform admin", async () => {
    const platformAdmin = await createPlatformAdminSession();

    const created = await request(app())
      .post("/api/platform/admins")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send(NEW_ADMIN);
    expect(created.status).toBe(201);
    expect(created.body.data.isPlatformAdmin).toBe(true);
    expect(created.body.data.passwordHash).toBeUndefined();

    const list = await request(app())
      .get("/api/platform/admins")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`);
    expect(list.body.data.map((a: { email: string }) => a.email)).toContain(NEW_ADMIN.email);

    const updated = await request(app())
      .put(`/api/platform/admins/${created.body.data.id}`)
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send({ name: "Admin Diperbarui" });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe("Admin Diperbarui");
  });

  it("rejects a duplicate platform-admin email", async () => {
    const platformAdmin = await createPlatformAdminSession();
    await request(app())
      .post("/api/platform/admins")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send(NEW_ADMIN);

    const res = await request(app())
      .post("/api/platform/admins")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send(NEW_ADMIN);
    expect(res.status).toBe(409);
  });

  it("deactivates another platform admin but rejects deactivating yourself", async () => {
    const platformAdmin = await createPlatformAdminSession();
    const created = await request(app())
      .post("/api/platform/admins")
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`)
      .send(NEW_ADMIN);

    const deactivated = await request(app())
      .delete(`/api/platform/admins/${created.body.data.id}`)
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`);
    expect(deactivated.status).toBe(200);

    const selfDeactivate = await request(app())
      .delete(`/api/platform/admins/${platformAdmin.user.id}`)
      .set("Authorization", `Bearer ${platformAdmin.accessToken}`);
    expect(selfDeactivate.status).toBe(409);
  });

  it("rejects a non-platform-admin", async () => {
    const admin = await setupTenant();
    const res = await request(app())
      .get("/api/platform/admins")
      .set("Authorization", `Bearer ${admin.accessToken}`);
    expect(res.status).toBe(403);
  });
});
