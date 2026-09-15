import { createHmac } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db } from "../src/lib/db.js";
import { registerTenant } from "../src/modules/auth/service.js";
import { tenantDomains } from "../src/modules/tenant-domains/service.js";
import { provisionTenant } from "../src/modules/tenants/provision.js";
import { tenantLoginUrl } from "../src/modules/tenant-domains/config.js";
import { register as registerOnboarding, applySession, complete as completeOnboarding } from "../src/modules/onboarding/service.js";
import { signMemberAccessToken } from "../src/middleware/member-auth.js";

vi.mock("../src/modules/onboarding/firebase.js", () => ({
  verifyFirebaseIdentity: vi.fn(async (token: string) => {
    if (token === "expired") throw new Error("Expired identity");
    return { uid: token, email: "admin@example.test", provider: "password", authTime: Date.now() / 1000 };
  }),
  assertFirebaseSession: vi.fn(async () => {})
}));
const base = "koperasi.inovasijayakarsa.id";
const key = "isolated-test-gateway-secret-at-least-32-chars";
const register = (slug: string) => registerTenant({ tenantName: slug, slug, registrationNo: slug, address: "Jakarta", type: "KONVENSIONAL",
  adminName: "Admin", adminEmail: `${slug}@example.test`, password: "Test-only-123", firstUnit: { type: "KSP", name: "Simpan pinjam" } });
function signed(method: string, path: string, slug = "alpha", time = Date.now()) {
  const host = `${slug}.${base}`;
  return { "x-siskop-host": host, "x-siskop-time": String(time), "x-siskop-signature": createHmac("sha256", key).update([time, method, path, host].join("\n")).digest("base64url") };
}
beforeEach(async () => {
  vi.stubEnv("JWT_SECRET", "test-secret"); vi.stubEnv("JWT_REFRESH_SECRET", "test-refresh-secret");
  vi.stubEnv("TENANT_BASE_DOMAIN", base); vi.stubEnv("TENANT_DOMAINS_ENABLED", "true");
  vi.stubEnv("TENANT_DOMAIN_RENAME_ENABLED", "true"); vi.stubEnv("TENANT_GATEWAY_SECRET", key);
  await db.tenant.deleteMany({}); await db.subscriptionPackage.deleteMany({});
});
afterEach(() => vi.unstubAllEnvs());
async function premium() {
  const session = await register("alpha");
  const pkg = await db.subscriptionPackage.create({ data: { name: "Eligible", price: 100000, maxUsers: 10, maxMembers: 100, modules: [], customSubdomainEnabled: true } });
  await db.tenant.update({ where: { id: session.user.tenantId }, data: { packageId: pkg.id } });
  await db.user.update({ where: { id: session.user.id, tenantId: session.user.tenantId }, data: { firebaseUid: "alpha-uid" } });
  return { session, caller: { tenantId: session.user.tenantId, userId: session.user.id } };
}
describe("workspace gateway and authentication", () => {
  it("generates registration addresses, denies unpaid workspaces, and returns the tenant login only after verified payment", async () => {
    vi.stubEnv("PUBLIC_APP_URL", "https://siskop-d0f8c.web.app"); vi.stubEnv("XENDIT_SECRET_KEY", "test-key"); vi.stubEnv("XENDIT_WEBHOOK_TOKEN", "test-callback"); vi.stubEnv("RESEND_API_KEY", "");
    const pkg = await db.subscriptionPackage.create({ data: { name: "Package", price: 100000, maxUsers: 10, maxMembers: 100, modules: [] } });
    const id = await registerOnboarding({ tenantName: "New koperasi", slug: "client-chosen", packageId: pkg.id, registrationNo: "NEW", address: "Jakarta", type: "KONVENSIONAL", adminName: "New Admin", idToken: "new-uid" });
    const order = await db.onboardingOrder.findUniqueOrThrow({ where: { id }, include: { tenant: true } });
    expect(order.tenant.slug).toMatch(/^new-koperasi-[a-f0-9]{12}$/);
    await expect(tenantDomains.resolve(order.tenant.slug)).rejects.toThrow("NOT_FOUND");
    await expect(completeOnboarding(id)).rejects.toThrow("CONFLICT");
    const attempt = await db.checkoutAttempt.create({ data: { orderId: id } });
    await applySession(attempt.id, { payment_session_id: "ps-preview", reference_id: attempt.id, session_type: "PAY", currency: "IDR", amount: 100000, status: "COMPLETED" });
    expect(await completeOnboarding(id)).toEqual({ next: "login", loginUrl: `https://${order.tenant.slug}.${base}/login` });
    expect((await tenantDomains.resolve(order.tenant.slug)).tenantId).toBe(order.tenantId);
  });
  it("also rejects member-portal tokens belonging to another workspace", async () => {
    await register("alpha"); const b = await register("beta");
    const token = signMemberAccessToken({ tenantId: b.user.tenantId, memberId: "fixture-member", role: "member" }, "test-secret", "15m");
    const res = await request(createApp()).get("/api/member/dashboard").set(signed("GET", "/api/member/dashboard")).auth(token, { type: "bearer" });
    expect(res.status).toBe(403);
  });
  it("resolves an active tenant and does not cache tenant responses", async () => {
    const session = await register("alpha");
    const response = await request(createApp()).get("/api/workspace").set(signed("GET", "/api/workspace"));
    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ tenantId: session.user.tenantId, name: "alpha", slug: "alpha", isAlias: false });
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
  it("accepts only the matching tenant's access token and refresh cookie", async () => {
    const a = await register("alpha"); const b = await register("beta");
    const app = createApp();
    expect((await request(app).get("/api/auth/me").set(signed("GET", "/api/auth/me")).auth(a.accessToken, { type: "bearer" })).status).toBe(200);
    expect((await request(app).get("/api/auth/me").set(signed("GET", "/api/auth/me")).auth(b.accessToken, { type: "bearer" })).status).toBe(403);
    expect((await request(app).post("/api/auth/refresh").set(signed("POST", "/api/auth/refresh")).set("Cookie", `siskop_refresh_token=${b.refreshToken}`)).status).toBe(401);
    const refreshed = await request(app).post("/api/auth/refresh").set(signed("POST", "/api/auth/refresh")).set("Cookie", `siskop_refresh_token=${a.refreshToken}`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers["set-cookie"][0]).not.toContain("Domain=");
  });
  it("scopes Firebase login and rejects a forged body tenant even for platform admins", async () => {
    const a = await register("alpha"); const b = await register("beta");
    await db.user.update({ where: { id: b.user.id, tenantId: b.user.tenantId }, data: { firebaseUid: "beta-uid", isPlatformAdmin: true } });
    const app = createApp();
    const wrong = await request(app).post("/api/onboarding/login").set(signed("POST", "/api/onboarding/login")).send({ idToken: "beta-uid", tenantId: a.user.tenantId });
    expect(wrong.status).toBe(401);
    const central = await request(app).post("/api/onboarding/login").send({ idToken: "beta-uid", tenantId: a.user.tenantId });
    expect(central.status).toBe(200); expect(central.body.data.session.user.tenantId).toBe(b.user.tenantId);
    const platformTenant = await request(app).post("/api/onboarding/login").set(signed("POST", "/api/onboarding/login", "beta")).send({ idToken: "beta-uid" });
    expect(platformTenant.status).toBe(401);
    await db.user.update({ where: { id: b.user.id, tenantId: b.user.tenantId }, data: { isPlatformAdmin: false } });
    const correct = await request(app).post("/api/onboarding/login").set(signed("POST", "/api/onboarding/login", "beta")).send({ idToken: "beta-uid" });
    expect(correct.status).toBe(200);
  });
  it.each(["missing", "forged", "stale", "method", "path"])("rejects %s gateway assertions", async (kind) => {
    await register("alpha");
    const headers = signed(kind === "method" ? "POST" : "GET", kind === "path" ? "/api/auth/me" : "/api/workspace", "alpha", kind === "stale" ? Date.now() - 31000 : Date.now());
    if (kind === "forged") headers["x-siskop-signature"] = "x".repeat(43);
    const res = await request(createApp()).get("/api/workspace").set(kind === "missing" ? { Host: `alpha.${base}`, "X-Forwarded-Host": `alpha.${base}` } : headers);
    expect(res.status).toBe(403);
  });
  it("rejects cross-origin requests, unknown tenants, inactive tenants, and reserved hosts", async () => {
    const a = await register("alpha"); const app = createApp();
    expect((await request(app).get("/api/workspace").set(signed("GET", "/api/workspace")).set("Origin", "https://evil.test")).status).toBe(403);
    expect((await request(app).get("/api/workspace").set(signed("GET", "/api/workspace", "missing"))).status).toBe(404);
    expect((await request(app).get("/api/workspace").set(signed("GET", "/api/workspace", "admin"))).status).toBe(404);
    await db.tenant.update({ where: { id: a.user.tenantId }, data: { isActive: false } });
    expect((await request(app).get("/api/workspace").set(signed("GET", "/api/workspace"))).status).toBe(404);
  });
  it("keeps billing and platform actions on the central site", async () => {
    await register("alpha");
    for (const path of ["/api/platform/tenants", "/api/onboarding/webhook", "/api/onboarding/register", "/api/scheduler/run-daily"]) {
      expect((await request(createApp()).post(path).set(signed("POST", path)).send({})).status).toBe(403);
    }
  });
});
describe("premium address changes", () => {
  it("preserves tenant identity and the old alias and records the annual allowance", async () => {
    const { caller } = await premium();
    const result = await tenantDomains.rename(caller, { slug: "alpha-new", idToken: "alpha-uid" });
    expect(result.slug).toBe("alpha-new"); expect(result.blockedReason).toBe("cooldown");
    expect(result.history).toHaveLength(1);
    expect((await tenantDomains.resolve("alpha")).tenantId).toBe(caller.tenantId);
    expect((await tenantDomains.resolve("alpha-new")).tenantId).toBe(caller.tenantId);
    const old = await request(createApp()).get("/api/workspace").set(signed("GET", "/api/workspace"));
    expect(old.body.data.isAlias).toBe(true);
    const write = await request(createApp()).post("/api/auth/refresh").set(signed("POST", "/api/auth/refresh"));
    expect(write.status).toBe(409); expect(write.body.error.code).toBe("WORKSPACE_MOVED");
    expect(write.body.error.details.loginUrl).toBe(`https://alpha-new.${base}/login`);
  });
  it("rejects basic packages, disabled editing, wrong identities, and missing permissions", async () => {
    const { caller } = await premium();
    await expect(tenantDomains.rename(caller, { slug: "changed", idToken: "other-uid" })).rejects.toThrow("UNAUTHORIZED");
    vi.stubEnv("TENANT_DOMAIN_RENAME_ENABLED", "false");
    await expect(tenantDomains.rename(caller, { slug: "changed", idToken: "alpha-uid" })).rejects.toThrow("FORBIDDEN");
    vi.stubEnv("TENANT_DOMAIN_RENAME_ENABLED", "true");
    await db.tenant.update({ where: { id: caller.tenantId }, data: { packageId: null } });
    await expect(tenantDomains.rename(caller, { slug: "changed", idToken: "alpha-uid" })).rejects.toThrow("FEATURE_NOT_ENTITLED");
    const role = await db.role.findFirstOrThrow({ where: { tenantId: caller.tenantId, name: "Viewer" } });
    await db.user.update({ where: { id: caller.userId, tenantId: caller.tenantId }, data: { roleId: role.id } });
    await expect(tenantDomains.rename(caller, { slug: "changed", idToken: "alpha-uid" })).rejects.toThrow("FORBIDDEN");
    expect((await tenantDomains.settings(caller)).blockedReason).toBe("permission");
  });
  it("does not consume an allowance on failures or no-ops and rejects retired-name theft", async () => {
    const { caller } = await premium(); await register("beta");
    await expect(tenantDomains.rename(caller, { slug: "beta", idToken: "alpha-uid" })).rejects.toThrow("CONFLICT");
    const same = await tenantDomains.rename(caller, { slug: "alpha", idToken: "alpha-uid" });
    expect(same.nextChangeAt).toBeNull(); expect(same.history).toHaveLength(0);
    await tenantDomains.rename(caller, { slug: "alpha-new", idToken: "alpha-uid" });
    await expect(provisionTenant({ name: "Thief", slug: "alpha", registrationNo: "thief", address: "x", type: "KONVENSIONAL", firstUnit: { type: "KSP", name: "KSP" } })).rejects.toThrow();
    await expect(tenantDomains.rename(caller, { slug: "again", idToken: "alpha-uid" })).rejects.toThrow("CONFLICT");
  });
  it("serializes concurrent changes so only one succeeds", async () => {
    const { caller } = await premium();
    const results = await Promise.allSettled(["one", "two"].map(slug => tenantDomains.rename(caller, { slug, idToken: "alpha-uid" })));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.tenantSlugChange.count({ where: { tenantId: caller.tenantId } })).toBe(1);
  });
  it("reserves a contested name for exactly one of two different tenants", async () => {
    const { caller } = await premium(); const beta = await register("beta");
    const alpha = await db.tenant.findUniqueOrThrow({ where: { id: caller.tenantId } });
    await db.tenant.update({ where: { id: beta.user.tenantId }, data: { packageId: alpha.packageId } });
    await db.user.update({ where: { id: beta.user.id, tenantId: beta.user.tenantId }, data: { firebaseUid: "beta-uid" } });
    const outcomes = await Promise.allSettled([
      tenantDomains.rename(caller, { slug: "contested", idToken: "alpha-uid" }),
      tenantDomains.rename({ tenantId: beta.user.tenantId, userId: beta.user.id }, { slug: "contested", idToken: "beta-uid" })
    ]);
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    const owner = await tenantDomains.resolve("contested");
    expect([caller.tenantId, beta.user.tenantId]).toContain(owner.tenantId);
  });
  it("retains the custom address on downgrade and keeps the cooldown after renewal", async () => {
    const { caller } = await premium();
    await tenantDomains.rename(caller, { slug: "custom", idToken: "alpha-uid" });
    await db.tenant.update({ where: { id: caller.tenantId }, data: { nextBillingDate: new Date(0) } });
    expect((await tenantDomains.settings(caller)).blockedReason).toBe("package");
    expect((await tenantDomains.resolve("custom")).tenantId).toBe(caller.tenantId);
    await db.tenant.update({ where: { id: caller.tenantId }, data: { nextBillingDate: new Date(Date.now() + 86400000) } });
    expect((await tenantDomains.settings(caller)).blockedReason).toBe("cooldown");
  });
  it("exposes settings and changes through permission-checked HTTP routes", async () => {
    const { session } = await premium(); const app = createApp();
    expect((await request(app).get("/api/tenant-domain")).status).toBe(401);
    const settings = await request(app).get("/api/tenant-domain").auth(session.accessToken, { type: "bearer" });
    expect(settings.status).toBe(200); expect(settings.body.data.canRename).toBe(true);
    const result = await request(app).put("/api/tenant-domain").auth(session.accessToken, { type: "bearer" }).send({ slug: "changed", idToken: "alpha-uid" });
    expect(result.status).toBe(200); expect(result.body.data.slug).toBe("changed");
  });
  it("preserves the central login URL until the feature is activated", () => {
    vi.stubEnv("TENANT_DOMAINS_ENABLED", "false"); vi.stubEnv("PUBLIC_APP_URL", "https://siskop-d0f8c.web.app");
    expect(tenantLoginUrl("alpha")).toBe("https://siskop-d0f8c.web.app/login");
  });
});
