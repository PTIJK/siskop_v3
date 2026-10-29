import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { db } from "../src/lib/db.js";
import { unauthorized } from "../src/lib/errors.js";
import { clearCatalogCache } from "../src/lib/pricing/catalog.js";
import { getTenantEntitlements, clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import type { CatalogSnapshot } from "../src/lib/pricing/snapshot.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { verifyFirebaseIdentity } from "../src/modules/onboarding/firebase.js";
import { seedJson } from "./pricing-fixture.js";

vi.mock("../src/modules/onboarding/firebase.js", () => ({ verifyFirebaseIdentity: vi.fn(), assertFirebaseSession: vi.fn() }));

const PREFIX = "REG-TEST";
const body = (over: Record<string, unknown> = {}) => ({
  subscription: { packageCode: "free", billingCycle: "MONTHLY" },
  tenantName: "Koperasi Uji",
  registrationNo: `${PREFIX}-1`,
  address: "Jl. Pengujian 1",
  type: "KONVENSIONAL",
  adminName: "Admin Uji",
  idToken: "verified-test-token",
  firstUnit: { type: "KSP", name: "Simpan pinjam" },
  ...over
});
const register = (over: Record<string, unknown> = {}, app = createApp()) => request(app).post("/api/onboarding/register").send(body(over));
const sub = (packageCode: string, extra: Record<string, unknown> = {}) => ({ subscription: { packageCode, billingCycle: "MONTHLY", ...extra } });

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
async function seed(withVat = false) {
  await resetCatalog();
  await loadPricingSeed(db, parsePricingSeed(seedJson({ withVat })));
  clearCatalogCache();
}
/** Publishes version 2 as a modified copy of version 1. */
async function publishV2(mutate: (s: CatalogSnapshot) => void) {
  const v1 = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
  const snapshot = structuredClone(v1.snapshot) as unknown as CatalogSnapshot;
  mutate(snapshot);
  await db.pricingVersion.create({ data: { version: 2, snapshot: snapshot as never } });
  clearCatalogCache();
}
async function clean() {
  await withoutTenantScope(async () => db.invoice.deleteMany({ where: { tenant: { registrationNo: { startsWith: PREFIX } } } }));
  await db.tenant.deleteMany({ where: { registrationNo: { startsWith: PREFIX } } });
}
const subscriptionOf = (slugOrId: { tenantId: string }) =>
  withoutTenantScope(async () => db.tenantSubscription.findUniqueOrThrow({ where: { tenantId: slugOrId.tenantId } }));
const invoicesOf = (tenantId: string) => withoutTenantScope(async () => db.invoice.findMany({ where: { tenantId } }));
async function tenantBySlug(res: request.Response) {
  return db.tenant.findUniqueOrThrow({ where: { slug: res.body.data.slug } });
}

beforeAll(async () => {
  if (!new URL(process.env.DATABASE_URL ?? "postgresql://localhost/missing").pathname.endsWith("_test"))
    throw new Error("Use a dedicated database ending in _test for these integration tests");
  process.env.JWT_SECRET ??= "test-secret";
});
beforeEach(async () => {
  await clean();
  await seed();
  clearEntitlementCache();
  vi.mocked(verifyFirebaseIdentity)
    .mockReset()
    .mockResolvedValue({ uid: "reg-test-uid", email: "admin@reg-test.example", provider: "password", authTime: Math.floor(Date.now() / 1000), emailVerified: true });
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await clean();
  await resetCatalog();
  await db.$disconnect();
});

describe("free registration", () => {
  it("activates the koperasi at once with an ACTIVE subscription and no invoice", async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ tenantName: "Koperasi Uji", status: "ACTIVE", packageName: "Free", invoice: null });
    const tenant = await tenantBySlug(res);
    expect(tenant.isActive).toBe(true);
    expect(tenant.nextBillingDate).toBeNull();
    const s = await subscriptionOf({ tenantId: tenant.id });
    expect(s).toMatchObject({ status: "ACTIVE", createdVia: "REGISTRATION", billingCycle: "MONTHLY", pricingVersion: 1 });
    expect(s.amountPerCycle.toString()).toBe("0");
    expect(await invoicesOf(tenant.id)).toHaveLength(0);
  });

  it("binds the verified Firebase identity to the admin user and sets no password", async () => {
    const res = await register();
    const tenant = await tenantBySlug(res);

    const user = await db.user.findUniqueOrThrow({ where: { firebaseUid: "reg-test-uid" } });

    expect(user.tenantId).toBe(tenant.id);
    expect(user.email).toBe("admin@reg-test.example");
    expect(user.passwordHash).toBeNull();
    expect(user.authProvider).toBe("password");
  });

  it("gives the tenant entitlements from the subscription snapshot", async () => {
    const res = await register();
    const tenant = await tenantBySlug(res);

    const ent = await getTenantEntitlements(tenant.id);

    expect(ent?.packageCode).toBe("free");
    expect(ent?.hasFeature("config_coa")).toBe(true);
    expect(ent?.hasFeature("accounting_book")).toBe(false);
    expect(ent?.limits).toEqual({ members: 50, users: 1, savingTypes: 2, loanTypes: 2 });
  });

  it("lets the new admin sign in straight away", async () => {
    await register();

    const login = await request(createApp()).post("/api/onboarding/login").send({ idToken: "verified-test-token" });

    expect(login.status).toBe(200);
    expect(login.body.data.next).toBe("dashboard");
    expect(login.body.data.session.accessToken).toBeTruthy();
  });
});

describe("paid registration", () => {
  it("creates an inactive koperasi, a PENDING_PAYMENT subscription and one OPEN invoice", async () => {
    const res = await register(sub("small"));

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PENDING_PAYMENT");
    const tenant = await tenantBySlug(res);
    expect(tenant.isActive).toBe(false);
    expect(tenant.nextBillingDate).toBeNull();
    const s = await subscriptionOf({ tenantId: tenant.id });
    expect(s.status).toBe("PENDING_PAYMENT");
    expect(s.amountPerCycle.toString()).toBe("500000");
    const [inv, ...rest] = await invoicesOf(tenant.id);
    expect(rest).toHaveLength(0);
    expect(inv).toMatchObject({ type: "REGISTRATION", status: "OPEN" });
    expect(inv!.number).toMatch(/^INV-\d{6}-0001$/);
    expect(inv!.total.toString()).toBe("500000");
  });

  it("returns the invoice and payment instructions in the status", async () => {
    await publishV2((s) => {
      s.settings.paymentInstructions = "Transfer ke BCA 123456 a.n. SISKOP";
    });

    const res = await register(sub("small"));

    expect(res.body.data.paymentInstructions).toBe("Transfer ke BCA 123456 a.n. SISKOP");
    expect(res.body.data.invoice).toMatchObject({ subtotal: "500000", total: "500000", status: "OPEN" });
    expect(res.body.data.invoice.number).toMatch(/^INV-\d{6}-\d{4}$/);
    expect(new Date(res.body.data.invoice.dueDate).getTime()).toBeGreaterThan(Date.now() + 13 * 86400_000);
  });

  it("leaves paymentInstructions null until the owner enters them", async () => {
    const res = await register(sub("small"));
    expect(res.body.data.paymentInstructions).toBeNull();
  });

  it("adds the owner's VAT to the invoice total", async () => {
    await seed(true);

    const res = await register(sub("small"));

    expect(res.body.data.invoice).toMatchObject({ subtotal: "500000", taxRate: "0.11", taxAmount: "55000", total: "555000" });
  });

  it("bills the yearly support fee with the first invoice", async () => {
    const res = await register(sub("small", { supportPlanCode: "SP1" }));

    expect(res.body.data.invoice.subtotal).toBe("5500000");
    const tenant = await tenantBySlug(res);
    expect((await subscriptionOf({ tenantId: tenant.id })).supportPlanId).not.toBeNull();
  });

  it("treats a free package with a paid support plan as awaiting payment", async () => {
    const res = await register(sub("free", { supportPlanCode: "SP1" }));

    expect(res.body.data.status).toBe("PENDING_PAYMENT");
    expect(res.body.data.invoice.total).toBe("5000000");
    expect((await tenantBySlug(res)).isActive).toBe(false);
  });

  it("quotes a Custom selection and stores its features", async () => {
    const res = await register(
      sub("custom", { featureKeys: ["unit_konsumen", "unit_pasar", "reports_market"] })
    );

    expect(res.status).toBe(201);
    expect(res.body.data.invoice.subtotal).toBe("400000");
    const tenant = await tenantBySlug(res);
    const s = await subscriptionOf({ tenantId: tenant.id });
    expect(s.selectedFeatureKeys.sort()).toEqual(["reports_market", "unit_konsumen", "unit_pasar"]);
  });

  it("numbers invoices in sequence", async () => {
    vi.mocked(verifyFirebaseIdentity).mockResolvedValueOnce({ uid: "u1", email: "u1@reg-test.example", provider: "password", authTime: Math.floor(Date.now() / 1000), emailVerified: true });
    const a = await register({ ...sub("small"), registrationNo: `${PREFIX}-A` });
    vi.mocked(verifyFirebaseIdentity).mockResolvedValueOnce({ uid: "u2", email: "u2@reg-test.example", provider: "password", authTime: Math.floor(Date.now() / 1000), emailVerified: true });
    const b = await register({ ...sub("small"), registrationNo: `${PREFIX}-B` });

    const n = (r: request.Response) => Number(r.body.data.invoice.number.split("-")[2]);
    expect(n(b)).toBe(n(a) + 1);
  });

  it("uses the newest published version, and leaves earlier subscriptions on theirs", async () => {
    const first = await register({ ...sub("small"), registrationNo: `${PREFIX}-V1` });
    await publishV2((s) => {
      s.packages.find((p) => p.code === "small")!.priceMonthly = "600000";
    });
    vi.mocked(verifyFirebaseIdentity).mockResolvedValue({ uid: "u-v2", email: "v2@reg-test.example", provider: "password", authTime: Math.floor(Date.now() / 1000), emailVerified: true });

    const second = await register({ ...sub("small"), registrationNo: `${PREFIX}-V2` });

    expect(second.body.data.invoice.total).toBe("600000");
    const s1 = await subscriptionOf({ tenantId: (await tenantBySlug(first)).id });
    const s2 = await subscriptionOf({ tenantId: (await tenantBySlug(second)).id });
    expect([s1.pricingVersion, s2.pricingVersion]).toEqual([1, 2]);
    expect(s1.amountPerCycle.toString()).toBe("500000");
  });
});

describe("the server never trusts the client's price or selection", () => {
  it("rejects a client-supplied price", async () => {
    const res = await register({ subscription: { packageCode: "small", billingCycle: "MONTHLY", amountPerCycle: "1" } });
    expect(res.status).toBe(422);
    expect(await db.tenant.count({ where: { registrationNo: { startsWith: PREFIX } } })).toBe(0);
  });

  it("rejects a client price placed beside the selection too", async () => {
    expect((await register({ ...sub("small"), price: "1", total: "1" })).status).toBe(422);
  });

  it("rejects an unknown or hidden package", async () => {
    expect((await register(sub("platinum"))).status).toBe(422);
    await publishV2((s) => {
      s.packages.find((p) => p.code === "small")!.isPublic = false;
    });
    expect((await register(sub("small"))).status).toBe(422);
  });

  it("rejects a Custom selection missing a requirement, and feature picking on a fixed package", async () => {
    expect((await register(sub("custom", { featureKeys: ["reports_market"] }))).status).toBe(422);
    expect((await register(sub("small", { featureKeys: ["unit_pasar"] }))).status).toBe(422);
  });

  it("answers 404 when nothing has been published", async () => {
    await db.pricingVersion.deleteMany({});
    clearCatalogCache();
    expect((await register(sub("free"))).status).toBe(404);
  });

  it("creates nothing when validation fails", async () => {
    await register(sub("platinum"));
    expect(await db.tenant.count({ where: { registrationNo: { startsWith: PREFIX } } })).toBe(0);
    expect(await withoutTenantScope(async () => db.user.count({ where: { firebaseUid: "reg-test-uid" } }))).toBe(0);
  });
});

describe("business type must agree with the package", () => {
  const unit = (type: string) => ({ firstUnit: { type, name: "Unit" } });

  it("allows KSP on every package", async () => {
    expect((await register({ ...sub("free"), ...unit("KSP") })).status).toBe(201);
  });

  it.each([["free"], ["small"]])("rejects a Konsumen koperasi on %s", async (pkg) => {
    const res = await register({ ...sub(pkg), ...unit("KONSUMEN") });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Konsumen/i);
  });

  it("rejects a Pasar (JASA) koperasi on Small but allows it on Medium", async () => {
    expect((await register({ ...sub("small"), ...unit("JASA") })).status).toBe(422);
    expect((await register({ ...sub("medium"), ...unit("JASA") })).status).toBe(201);
  });

  it("allows Konsumen on Medium and on Custom with the Konsumen feature", async () => {
    expect((await register({ ...sub("medium"), ...unit("KONSUMEN"), registrationNo: `${PREFIX}-M` })).status).toBe(201);
    vi.mocked(verifyFirebaseIdentity).mockResolvedValue({ uid: "u-c", email: "c@reg-test.example", provider: "password", authTime: Math.floor(Date.now() / 1000), emailVerified: true });
    expect((await register({ ...sub("custom", { featureKeys: ["unit_konsumen"] }), ...unit("KONSUMEN"), registrationNo: `${PREFIX}-C` })).status).toBe(201);
  });

  it("rejects Custom without the matching feature", async () => {
    expect((await register({ ...sub("custom"), ...unit("KONSUMEN") })).status).toBe(422);
  });

  it("rejects unit types the package matrix does not cover", async () => {
    expect((await register({ ...sub("enterprise"), ...unit("PRODUSEN") })).status).toBe(422);
  });
});

describe("identity and duplicates", () => {
  it("requires an identity token", async () => {
    expect((await register({ idToken: undefined })).status).toBe(422);
  });

  it("rejects an invalid Firebase proof and creates nothing", async () => {
    vi.mocked(verifyFirebaseIdentity).mockRejectedValue(unauthorized());
    const res = await register();
    expect(res.status).toBe(401);
    expect(await db.tenant.count({ where: { registrationNo: { startsWith: PREFIX } } })).toBe(0);
  });

  it("rejects a duplicate registration number and a duplicate Firebase identity with 409, leaving no orphan tenant", async () => {
    expect((await register()).status).toBe(201);
    expect((await register({ tenantName: "Lain" })).status).toBe(409);
    expect((await register({ registrationNo: `${PREFIX}-OTHER` })).status).toBe(409);
    expect(await db.tenant.count({ where: { registrationNo: { startsWith: PREFIX } } })).toBe(1);
  });

  it("rejects reserved workspace names", async () => {
    expect((await register({ slug: "www" })).status).toBe(422);
  });
});

describe("registration status and resuming", () => {
  const cookieOf = (res: request.Response) => (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("siskop_onboarding="))!.split(";")[0]!;

  it("sets a signed registration cookie and serves the status from it, uncached", async () => {
    const app = createApp();
    const reg = await register(sub("small"), app);
    expect(reg.status).toBe(201);

    const res = await request(app).get("/api/onboarding/status").set("Cookie", cookieOf(reg));

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "PENDING_PAYMENT", packageName: "Small", tenantName: "Koperasi Uji" });
    expect(res.headers["cache-control"]).toMatch(/no-store/);
  });

  it("refuses a status request without a valid cookie", async () => {
    const app = createApp();
    expect((await request(app).get("/api/onboarding/status")).status).toBe(401);
    expect((await request(app).get("/api/onboarding/status").set("Cookie", "siskop_onboarding=not-a-token")).status).toBe(401);
  });

  it("will not take a raw tenant id as a cookie", async () => {
    const app = createApp();
    const reg = await register(sub("small"), app);
    const tenant = await tenantBySlug(reg);
    expect((await request(app).get("/api/onboarding/status").set("Cookie", `siskop_onboarding=${tenant.id}`)).status).toBe(401);
  });

  it("reflects payment: once the subscription is ACTIVE the status says so", async () => {
    const app = createApp();
    const reg = await register(sub("small"), app);
    const tenant = await tenantBySlug(reg);
    await withoutTenantScope(async () => db.tenantSubscription.update({ where: { tenantId: tenant.id }, data: { status: "ACTIVE" } }));
    await db.tenant.update({ where: { id: tenant.id }, data: { isActive: true } });

    const res = await request(app).get("/api/onboarding/status").set("Cookie", cookieOf(reg));

    expect(res.body.data.status).toBe("ACTIVE");
  });

  it("does not let an unpaid administrator sign in, and sends them to the awaiting-payment status", async () => {
    await register(sub("small"));

    const login = await request(createApp()).post("/api/onboarding/login").send({ idToken: "verified-test-token" });

    expect(login.status).toBe(200);
    expect(login.body.data).toMatchObject({ next: "awaiting_payment", status: { status: "PENDING_PAYMENT", packageName: "Small" } });
    expect(login.body.data.session).toBeUndefined();
    expect(JSON.stringify(login.body)).not.toContain("refreshToken");
  });

  it("recovers the registration with the same Firebase identity and sets the cookie again", async () => {
    const app = createApp();
    await register(sub("small"), app);

    const other = request.agent(app);
    const resumed = await other.post("/api/onboarding/firebase-resume").send({ idToken: "verified-test-token" });

    expect(resumed.status).toBe(200);
    expect(resumed.body.data).toMatchObject({ next: "awaiting_payment", status: { invoice: { status: "OPEN" } } });
    expect((await other.get("/api/onboarding/status")).status).toBe(200);
  });

  it("will not resume for an identity that has no pending registration", async () => {
    await register(sub("small"));
    vi.mocked(verifyFirebaseIdentity).mockResolvedValue({ uid: "stranger", email: "x@reg-test.example", provider: "google.com", authTime: Math.floor(Date.now() / 1000), emailVerified: true });
    expect((await request(createApp()).post("/api/onboarding/firebase-resume").send({ idToken: "x" })).status).toBe(401);
  });

  it("refuses a state-changing request from a foreign origin", async () => {
    const res = await request(createApp()).post("/api/onboarding/register").set("Origin", "https://attacker.example").send(body());
    expect(res.status).toBe(403);
  });
});

describe("the retired Xendit checkout is gone", () => {
  it.each([
    ["post", "/api/onboarding/checkout"],
    ["post", "/api/onboarding/webhook"],
    ["post", "/api/onboarding/reconcile"],
    ["post", "/api/onboarding/complete"],
    ["post", "/api/onboarding/resume"],
    ["get", "/api/onboarding/packages"]
  ] as const)("%s %s no longer exists", async (method, path) => {
    const res = await request(createApp())[method](path).send({});
    expect(res.status).toBe(404);
  });
});

describe("invoice email", () => {
  function stubResend(status = 200) {
    const sent: { headers: Record<string, string>; payload: { to: string[]; subject: string; text: string; html: string } }[] = [];
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("RESEND_FROM_EMAIL", "SISKOP <noreply@siskop.example>");
    vi.stubEnv("PUBLIC_APP_URL", "https://siskop.example");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        sent.push({ headers: init!.headers as Record<string, string>, payload: JSON.parse(String(init!.body)) });
        return new Response(JSON.stringify(status === 200 ? { id: "email-1" } : { message: "down" }), { status });
      })
    );
    return sent;
  }

  it("emails the invoice number, total, due date and payment instructions to the administrator", async () => {
    await publishV2((s) => {
      s.settings.paymentInstructions = "Transfer ke BCA 123456";
    });
    const sent = stubResend();

    const res = await register(sub("small"));
    await vi.waitFor(() => expect(sent).toHaveLength(1));

    const mail = sent[0]!;
    expect(mail.payload.to).toEqual(["admin@reg-test.example"]);
    expect(mail.payload.subject).toContain(res.body.data.invoice.number);
    expect(mail.payload.text).toContain("500.000");
    expect(mail.payload.text).toContain("Transfer ke BCA 123456");
    expect(mail.headers["Idempotency-Key"]).toMatch(/^registration-invoice\//);
  });

  it("does not email a free registration", async () => {
    const sent = stubResend();
    await register(sub("free"));
    await new Promise((r) => setTimeout(r, 100));
    expect(sent).toHaveLength(0);
  });

  it("still registers when the email provider is down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    stubResend(503);

    const res = await register(sub("small"));

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PENDING_PAYMENT");
    warn.mockRestore();
  });

  it("still registers when email is not configured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect((await register(sub("small"))).status).toBe(201);
    warn.mockRestore();
  });
});
