import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db } from "../src/lib/db.js";
import { clearCatalogCache } from "../src/lib/pricing/catalog.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { verifyFirebaseIdentity } from "../src/modules/onboarding/firebase.js";
import { seedJson } from "./pricing-fixture.js";
import { cleanReferrals, makePartner } from "./referral-fixture.js";

vi.mock("../src/modules/onboarding/firebase.js", () => ({ verifyFirebaseIdentity: vi.fn(), assertFirebaseSession: vi.fn() }));

const PREFIX = "REFATT-TEST";
const ADMIN_EMAIL = "admin@refatt-test.example";
const body = (over: Record<string, unknown> = {}) => ({
  subscription: { packageCode: "free", billingCycle: "MONTHLY" },
  tenantName: "Koperasi Rujukan",
  registrationNo: `${PREFIX}-1`,
  address: "Jl. Pengujian 1",
  type: "KONVENSIONAL",
  adminName: "Admin Uji",
  idToken: "verified-test-token",
  firstUnit: { type: "KSP", name: "Simpan pinjam" },
  ...over
});
const register = (over: Record<string, unknown> = {}) => request(createApp()).post("/api/onboarding/register").send(body(over));
const check = (code: string) => request(createApp()).get(`/api/onboarding/referral/${encodeURIComponent(code)}`);
const referralOf = (tenantId: string) => withoutTenantScope(async () => db.tenantReferral.findUnique({ where: { tenantId } }));
const tenantCount = () => db.tenant.count({ where: { registrationNo: { startsWith: PREFIX } } });

async function resetCatalog() {
  await withoutTenantScope(async () => db.invoice.deleteMany({}));
  await withoutTenantScope(async () => db.tenantSubscription.deleteMany({}));
  await db.packageFeature.deleteMany({});
  await db.feature.deleteMany({});
  await db.subscriptionPackage.deleteMany({ where: { code: { not: null } } });
  await db.volumeAddon.deleteMany({});
  await db.supportPlan.deleteMany({});
  await db.pricingSetting.deleteMany({});
  await db.pricingVersion.deleteMany({});
  await db.pricingAuditLog.deleteMany({});
}
async function clean() {
  await cleanReferrals();
  await withoutTenantScope(async () => db.invoice.deleteMany({ where: { tenant: { registrationNo: { startsWith: PREFIX } } } }));
  await db.tenant.deleteMany({ where: { registrationNo: { startsWith: PREFIX } } });
}

beforeAll(() => {
  if (!new URL(process.env.DATABASE_URL ?? "postgresql://localhost/missing").pathname.endsWith("_test"))
    throw new Error("Use a dedicated database ending in _test for these integration tests");
  process.env.JWT_SECRET ??= "test-secret";
});
beforeEach(async () => {
  await clean();
  await resetCatalog();
  await loadPricingSeed(db, parsePricingSeed(seedJson({ withVat: false })));
  clearCatalogCache();
  clearEntitlementCache();
  vi.mocked(verifyFirebaseIdentity)
    .mockReset()
    .mockResolvedValue({ uid: "refatt-test-uid", email: ADMIN_EMAIL, provider: "password", authTime: Math.floor(Date.now() / 1000), emailVerified: true });
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await clean();
  await resetCatalog();
  await db.$disconnect();
});

describe("GET /api/onboarding/referral/:code", () => {
  it("is valid for an ACTIVE partner and returns only the display name", async () => {
    const partner = await makePartner({ code: "NEX-CHECK1" });
    const res = await check("NEX-CHECK1");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ valid: true, partnerName: partner.name });
  });

  it("normalises case and a missing prefix", async () => {
    await makePartner({ code: "NEX-CHECK2" });
    expect((await check("check2")).body.data.valid).toBe(true);
  });

  it.each(["PENDING", "REJECTED", "SUSPENDED"] as const)("is invalid for a %s partner", async (status) => {
    await makePartner({ code: status === "PENDING" ? null : "NEX-CHECK3", status });
    const res = await check("NEX-CHECK3");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ valid: false, partnerName: null });
  });

  it("is invalid for an unknown or malformed code, with the same shape", async () => {
    expect((await check("NEX-NOPE99")).body.data).toEqual({ valid: false, partnerName: null });
    expect((await check("!!")).body.data).toEqual({ valid: false, partnerName: null });
  });
});

describe("registration with a referral code", () => {
  it("attributes the new koperasi, snapshotting the partner's rate and months", async () => {
    const partner = await makePartner({ code: "NEX-REG001", rate: "0.15", months: 6 });
    const res = await register({ referralCode: "nex-reg001" });
    expect(res.status).toBe(201);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: res.body.data.slug } });
    const ref = await referralOf(tenant.id);
    expect(ref).toMatchObject({ partnerId: partner.id, codeUsed: "NEX-REG001", months: 6, source: "REGISTRATION", flaggedSelfReferral: false });
    expect(ref!.rate.toString()).toBe("0.15");
    expect(ref!.windowEndsAt.getTime()).toBeGreaterThan(ref!.attributedAt.getTime());
  });

  it("accepts a bare suffix typed by the user", async () => {
    await makePartner({ code: "NEX-REG002" });
    const res = await register({ referralCode: "REG002" });
    expect(res.status).toBe(201);
  });

  it("registers normally without a code", async () => {
    expect((await register()).status).toBe(201);
    expect(await withoutTenantScope(async () => db.tenantReferral.count())).toBe(0);
  });

  it("treats a blank code as no code", async () => {
    expect((await register({ referralCode: "  " })).status).toBe(201);
    expect(await withoutTenantScope(async () => db.tenantReferral.count())).toBe(0);
  });

  it.each(["unknown", "PENDING", "REJECTED", "SUSPENDED"] as const)("rejects a %s code with a validation error and creates nothing", async (kind) => {
    if (kind !== "unknown") await makePartner({ code: kind === "PENDING" ? null : "NEX-BAD001", status: kind });
    const res = await register({ referralCode: "NEX-BAD001" });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await tenantCount()).toBe(0);
  });

  it("flags a self-referral when the partner's email matches the Super Admin's", async () => {
    await makePartner({ code: "NEX-SELF01", email: ADMIN_EMAIL.toUpperCase() });
    const res = await register({ referralCode: "NEX-SELF01" });
    expect(res.status).toBe(201);
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: res.body.data.slug } });
    expect((await referralOf(tenant.id))!.flaggedSelfReferral).toBe(true);
  });
});
