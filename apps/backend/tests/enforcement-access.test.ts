import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/lib/db.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { app, createMemberAs, createStaffSession, DEFAULT_MEMBER, setupTenant } from "./helpers.js";
import { attachSubscription, resetCatalog, seedCatalog } from "./billing-fixture.js";

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  await seedCatalog();
  clearEntitlementCache();
  vi.stubEnv("PRICING_V2_ENFORCEMENT", "on");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await db.tenant.deleteMany({});
  await resetCatalog();
});

const PORTAL_PASSWORD = "15031985"; // DEFAULT_MEMBER.birthDate 1985-03-15 as DDMMYYYY
const custom = (featureKeys: string[]) => ({ packageCode: "custom", featureKeys });

describe("self registration page (member_portal-style gate by tenant, no login)", () => {
  it("is closed to a koperasi whose package lacks self_registration, even if the switch is on", async () => {
    const t = await setupTenant({ slug: "demo" });
    await attachSubscription(t.user.tenantId, custom([]));

    const page = await request(app()).get("/api/public/register/demo");
    expect(page.status).toBe(200);
    expect(page.body.data.selfRegistrationEnabled).toBe(false);

    const post = await request(app()).post("/api/public/register/demo").send({});
    expect(post.status).toBe(404);
  });

  it("is open once the package includes self_registration", async () => {
    const t = await setupTenant({ slug: "demo" });
    await attachSubscription(t.user.tenantId, custom(["self_registration"]));
    expect((await request(app()).get("/api/public/register/demo")).body.data.selfRegistrationEnabled).toBe(true);
    expect((await request(app()).post("/api/public/register/demo").send({})).status).not.toBe(404);
  });

  it("does not change while enforcement is off", async () => {
    const t = await setupTenant({ slug: "demo" });
    await attachSubscription(t.user.tenantId, custom([]));
    vi.stubEnv("PRICING_V2_ENFORCEMENT", "off");
    expect((await request(app()).get("/api/public/register/demo")).body.data.selfRegistrationEnabled).toBe(true);
  });
});

describe("member portal", () => {
  async function portalMember(featureKeys: string[]) {
    const admin = await setupTenant();
    await attachSubscription(admin.user.tenantId, custom(featureKeys));
    // Created before the gate matters: the staff routes need members, which every package has.
    const member = await createMemberAs(admin.accessToken);
    await request(app()).post(`/api/members/${member.id}/portal-access`).set("Authorization", `Bearer ${admin.accessToken}`).send();
    return admin;
  }
  const login = () => request(app()).post("/api/member-auth/login").set("Host", "demo.localhost").send({ nik: DEFAULT_MEMBER.nik, password: PORTAL_PASSWORD });

  it("refuses member login when the package lacks member_portal", async () => {
    await portalMember([]);
    const res = await login();
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: "FEATURE_NOT_ENTITLED", details: { feature: "member_portal" } });
  });

  it("allows it once the package includes member_portal", async () => {
    await portalMember(["member_portal"]);
    expect((await login()).status).toBe(200);
  });

  it("a wrong password still looks like any other failed login, not a package error", async () => {
    await portalMember([]);
    const res = await request(app()).post("/api/member-auth/login").set("Host", "demo.localhost").send({ nik: DEFAULT_MEMBER.nik, password: "salah" });
    expect(res.status).toBe(401);
  });
});

describe("collector login", () => {
  it("refuses a Kolektor when the package lacks collector_access, but not other staff", async () => {
    const admin = await setupTenant();
    await attachSubscription(admin.user.tenantId, custom([]));

    const teller = await request(app()).post("/api/auth/login").set("Host", "demo.localhost").send({ email: "teller@demo.test", password: "rahasia123" });
    expect(teller.status).toBe(401); // no such user yet: proves the route works before the gate is involved

    await db.user.create({
      data: {
        tenantId: admin.user.tenantId,
        roleId: (await db.role.findFirstOrThrow({ where: { tenantId: admin.user.tenantId, name: "Kolektor" } })).id,
        email: "kolektor@demo.test",
        name: "Kolektor",
        passwordHash: (await import("bcryptjs")).default.hashSync("rahasia123", 10),
        unitAssignments: { create: [{ unitId: (await db.cooperativeUnit.findFirstOrThrow({ where: { tenantId: admin.user.tenantId } })).id }] }
      }
    });
    const res = await request(app()).post("/api/auth/login").set("Host", "demo.localhost").send({ email: "kolektor@demo.test", password: "rahasia123" });
    expect(res.status).toBe(403);
    expect(res.body.error.details).toMatchObject({ feature: "collector_access" });

    const other = await createStaffSession(admin.user.tenantId, "demo", "Teller", "teller2@demo.test");
    expect(other.accessToken).toBeTypeOf("string");
  });

  it("lets a Kolektor in once the package includes collector_access", async () => {
    const admin = await setupTenant();
    await attachSubscription(admin.user.tenantId, custom(["collector_access"]));
    const kolektor = await createStaffSession(admin.user.tenantId, "demo", "Kolektor", "kolektor@demo.test");
    expect(kolektor.accessToken).toBeTypeOf("string");
  });
});
