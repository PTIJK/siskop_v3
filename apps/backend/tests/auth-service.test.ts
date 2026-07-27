import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "../src/lib/db.js";
import { verifyAccessToken } from "../src/middleware/auth.js";
import { registerTenant, login, refreshSession } from "../src/modules/auth/service.js";

const SECRET = "test-secret";

const REGISTRATION = {
  tenantName: "KSP Demo",
  slug: "demo",
  cooperativeId: "KOP-DEMO",
  address: "Jl. Demo 1",
  adminName: "Admin Demo",
  adminEmail: "admin@demo.test",
  adminPhone: "0812000000",
  password: "rahasia123",
  firstUnit: { type: "KSP", name: "Simpan Pinjam" }
};

beforeAll(() => {
  process.env.JWT_SECRET = SECRET;
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
});

beforeEach(async () => {
  await db.tenant.deleteMany({});
});

describe("registerTenant", () => {
  it("creates tenant, first unit, and admin user, and returns a usable session", async () => {
    const session = await registerTenant(REGISTRATION);

    expect(session.user.email).toBe("admin@demo.test");
    expect(session.user.role).toBe("tenant_admin");

    const claims = verifyAccessToken(session.accessToken, SECRET);
    expect(claims.tenantId).toBe(session.user.tenantId);
    expect(claims.unitIds).toHaveLength(1);
  });

  it("stores the password hashed, never in plaintext", async () => {
    await registerTenant(REGISTRATION);

    const user = await db.user.findFirst({ where: { email: "admin@demo.test" } });
    expect(user?.passwordHash).toBeDefined();
    expect(user?.passwordHash).not.toBe(REGISTRATION.password);
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it("rejects a duplicate slug — the slug is the login subdomain", async () => {
    await registerTenant(REGISTRATION);
    await expect(
      registerTenant({ ...REGISTRATION, cooperativeId: "KOP-OTHER", adminEmail: "b@x.test" })
    ).rejects.toThrow();
  });

  it("rejects a slug that is not a valid hostname label", async () => {
    await expect(registerTenant({ ...REGISTRATION, slug: "Not A Slug!" })).rejects.toThrow();
  });

  // Registration is several writes; a failure partway through must leave nothing.
  it("leaves no tenant behind when the unit type is invalid", async () => {
    await expect(
      registerTenant({ ...REGISTRATION, firstUnit: { type: "NOPE", name: "Broken" } })
    ).rejects.toThrow();

    expect(await db.tenant.findMany({ where: { slug: "demo" } })).toHaveLength(0);
  });
});

describe("login", () => {
  beforeEach(async () => {
    await registerTenant(REGISTRATION);
  });

  it("issues a token carrying tenantId and the admin's units", async () => {
    const session = await login("demo", "admin@demo.test", "rahasia123");

    const claims = verifyAccessToken(session.accessToken, SECRET);
    expect(claims.role).toBe("tenant_admin");
    expect(claims.unitIds).toHaveLength(1);

    const units = await db.cooperativeUnit.findMany({ where: { tenantId: claims.tenantId } });
    expect(claims.unitIds).toEqual([units[0]?.id]);
  });

  it("never returns the password hash to the caller", async () => {
    const session = await login("demo", "admin@demo.test", "rahasia123");
    expect(JSON.stringify(session)).not.toContain("$2");
  });

  it("rejects a wrong password", async () => {
    await expect(login("demo", "admin@demo.test", "salah")).rejects.toThrow(/UNAUTHORIZED/);
  });

  // The same message for both, so login cannot be used to enumerate accounts.
  it("reports an unknown email exactly as it reports a wrong password", async () => {
    const wrongPassword = await login("demo", "admin@demo.test", "salah").catch((e) => e.message);
    const unknownEmail = await login("demo", "nobody@demo.test", "rahasia123").catch(
      (e) => e.message
    );
    expect(unknownEmail).toBe(wrongPassword);
  });

  it("rejects an unknown tenant slug", async () => {
    await expect(login("nosuchtenant", "admin@demo.test", "rahasia123")).rejects.toThrow();
  });

  // Email is unique only within a tenant, so the slug must actually scope the
  // lookup — the same address in another tenant must not authenticate here.
  it("does not authenticate a user from a different tenant", async () => {
    await registerTenant({
      ...REGISTRATION,
      tenantName: "KSP Lain",
      slug: "lain",
      cooperativeId: "KOP-LAIN",
      // Same admin login address, different cooperative contact address: one
      // person administering two koperasi is legitimate.
      tenantEmail: "kontak@lain.test",
      password: "berbeda123"
    });

    await expect(login("demo", "admin@demo.test", "berbeda123")).rejects.toThrow(/UNAUTHORIZED/);
    const other = await login("lain", "admin@demo.test", "berbeda123");
    const claims = verifyAccessToken(other.accessToken, SECRET);
    const lain = await db.tenant.findUnique({ where: { slug: "lain" } });
    expect(claims.tenantId).toBe(lain?.id);
  });

  it("rejects a deactivated user", async () => {
    await db.user.updateMany({ where: { email: "admin@demo.test" }, data: { isActive: false } });
    await expect(login("demo", "admin@demo.test", "rahasia123")).rejects.toThrow(/UNAUTHORIZED/);
  });

  it("rejects login to a deactivated tenant", async () => {
    await db.tenant.updateMany({ where: { slug: "demo" }, data: { isActive: false } });
    await expect(login("demo", "admin@demo.test", "rahasia123")).rejects.toThrow();
  });

  it("records lastLoginAt", async () => {
    await login("demo", "admin@demo.test", "rahasia123");
    const user = await db.user.findFirst({ where: { email: "admin@demo.test" } });
    expect(user?.lastLoginAt).toBeInstanceOf(Date);
  });
});

describe("refreshSession", () => {
  it("exchanges a refresh token for a new access token", async () => {
    const session = await registerTenant(REGISTRATION);
    const refreshed = await refreshSession(session.refreshToken);

    const claims = verifyAccessToken(refreshed.accessToken, SECRET);
    expect(claims.tenantId).toBe(session.user.tenantId);
  });

  it("rejects an access token presented as a refresh token", async () => {
    const session = await registerTenant(REGISTRATION);
    await expect(refreshSession(session.accessToken)).rejects.toThrow();
  });

  it("rejects a garbage token", async () => {
    await expect(refreshSession("not-a-token")).rejects.toThrow();
  });
});
