import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { clearCatalogCache } from "../src/lib/pricing/catalog.js";
import { clearEntitlementCache, getTenantEntitlements } from "../src/lib/pricing/entitlements.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import { app, createPlatformAdminSession, setupTenant } from "./helpers.js";

const SEED_PATH = resolve(__dirname, "../../../docs/package-modules/pricing.seed.json");
const seedJson = () => JSON.parse(readFileSync(SEED_PATH, "utf8"));

async function resetCatalog() {
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

let token: string;
let adminId: string;

beforeEach(async () => {
  process.env.JWT_SECRET = "test-secret";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  await db.tenant.deleteMany({});
  await resetCatalog();
  await loadPricingSeed(db, parsePricingSeed(seedJson()));
  clearCatalogCache();
  clearEntitlementCache();
  const session = await createPlatformAdminSession();
  token = session.accessToken;
  adminId = session.user.id;
});
afterEach(async () => {
  await db.tenant.deleteMany({});
});

const P = "/api/platform/pricing";
const get = (path: string) => request(app()).get(`${P}${path}`).set("Authorization", `Bearer ${token}`);
const put = (path: string, body: unknown) => request(app()).put(`${P}${path}`).set("Authorization", `Bearer ${token}`).send(body as object);
const post = (path: string, body: unknown = {}) => request(app()).post(`${P}${path}`).set("Authorization", `Bearer ${token}`).send(body as object);

describe("access", () => {
  it("rejects anonymous callers", async () => {
    expect((await request(app()).get(`${P}/draft`)).status).toBe(401);
  });

  it("rejects a tenant admin who is not a platform admin", async () => {
    const tenant = await setupTenant({ slug: "biasa", registrationNo: "KOP-BIASA", adminEmail: "biasa@demo.test" });
    const res = await request(app()).get(`${P}/draft`).set("Authorization", `Bearer ${tenant.accessToken}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /draft", () => {
  it("returns the working draft, the published version and a zero change count", async () => {
    const res = await get("/draft");

    expect(res.status).toBe(200);
    expect(res.body.data.publishedVersion).toBe(1);
    expect(res.body.data.changeCount).toBe(0);
    expect(res.body.data.catalog.packages.map((p: { code: string }) => p.code)).toEqual(["free", "small", "medium", "enterprise", "custom"]);
    expect(res.body.data.catalog.settings.taxRate).toBeNull();
  });
});

describe("PUT /packages/:code", () => {
  it("edits the draft only, leaves the published catalog alone, and audits the change", async () => {
    const res = await put("/packages/small", { priceMonthly: "600000", priceYearly: "6000000", limits: { members: 600, users: 12, savingTypes: 10, loanTypes: 10 } });

    expect(res.status).toBe(200);
    const draft = (await get("/draft")).body.data;
    const small = draft.catalog.packages.find((p: { code: string }) => p.code === "small");
    expect(small.priceMonthly).toBe("600000");
    expect(small.limits).toEqual({ members: 600, users: 12, savingTypes: 10, loanTypes: 10 });
    expect(draft.changeCount).toBeGreaterThan(0);
    const published = await request(app()).get("/api/public/pricing");
    expect(published.body.data.packages.find((p: { code: string }) => p.code === "small").priceMonthly).toBe("500000");
    const audit = await db.pricingAuditLog.findFirstOrThrow({ where: { entity: "SubscriptionPackage", entityId: "small" } });
    expect(audit.actorId).toBe(adminId);
    expect(audit.action).toBe("UPDATE");
    expect(audit.before).toMatchObject({ priceMonthly: "500000" });
    expect(audit.after).toMatchObject({ priceMonthly: "600000" });
  });

  it("keeps the legacy price column in step with the monthly price", async () => {
    await put("/packages/small", { priceMonthly: "600000", priceYearly: "6000000" });
    const row = await db.subscriptionPackage.findUniqueOrThrow({ where: { code: "small" } });
    expect(row.price.toString()).toBe("600000");
  });

  it("accepts a null limit as unlimited", async () => {
    await put("/packages/small", { limits: { members: null, users: 10, savingTypes: 10, loanTypes: 10 } });
    const row = await db.subscriptionPackage.findUniqueOrThrow({ where: { code: "small" } });
    expect(row.maxMembers).toBeNull();
  });

  it("rejects a fixed package with a monthly price and no yearly price", async () => {
    const res = await put("/packages/free", { priceMonthly: "100000", priceYearly: null });
    expect(res.status).toBe(422);
  });

  it("rejects fields it does not own, such as code or isCustom", async () => {
    expect((await put("/packages/small", { code: "other" })).status).toBe(422);
    expect((await put("/packages/small", { isCustom: true })).status).toBe(422);
  });

  it("answers 404 for an unknown package", async () => {
    expect((await put("/packages/platinum", { name: "x" })).status).toBe(404);
  });

  it("rejects a negative price", async () => {
    expect((await put("/packages/small", { priceMonthly: "-1", priceYearly: "1" })).status).toBe(422);
  });

  it("rejects an amount too large to store with 422, not a server error", async () => {
    const tooBig = "10000000000000";
    expect((await put("/packages/small", { priceMonthly: tooBig, priceYearly: "1" })).status).toBe(422);
    expect((await put("/packages/small", { priceMonthly: 1e13, priceYearly: "1" })).status).toBe(422);
    expect((await put("/features/ocr", { customPrice: tooBig })).status).toBe(422);
    expect((await put("/addons", [{ itemKey: "MEMBERS", stepQty: 100, price: tooBig, period: "YEARLY" }])).status).toBe(422);
    expect((await put("/support-plans", [{ code: "SP1", name: "SP.1", yearlyCost: tooBig, remote: true, onsite: true, visitsPerYear: 4, slaHours: 6, aiSupport: false }])).status).toBe(422);
  });

  it("still accepts the largest amount the column holds", async () => {
    const res = await put("/packages/small", { priceMonthly: "9999999999999.99", priceYearly: "9999999999999.99" });
    expect(res.status).toBe(200);
  });
});

describe("PUT /features/:key", () => {
  it("changes a feature's Custom price", async () => {
    const res = await put("/features/ocr", { customPrice: "1200000" });
    expect(res.status).toBe(200);
    const f = (await get("/draft")).body.data.catalog.features.find((x: { key: string }) => x.key === "ocr");
    expect(f.customPrice).toBe("1200000");
  });

  it("creates a new feature with a parent and requires", async () => {
    const res = await put("/features/ocr_batch", { name: "OCR Batch", parentKey: "ocr", requires: ["ocr"], customPrice: "300000", priceGroup: null });
    expect(res.status).toBe(200);
    const f = (await get("/draft")).body.data.catalog.features.find((x: { key: string }) => x.key === "ocr_batch");
    expect(f).toMatchObject({ parentKey: "ocr", requires: ["ocr"], customPrice: "300000" });
  });

  it("requires a name when creating", async () => {
    expect((await put("/features/brand_new", { customPrice: "1" })).status).toBe(422);
  });

  it("rejects a requires or parent that is not a feature", async () => {
    expect((await put("/features/ocr", { requires: ["ghost"] })).status).toBe(422);
    expect((await put("/features/ocr", { parentKey: "ghost" })).status).toBe(422);
  });

  it("rejects a feature requiring itself", async () => {
    expect((await put("/features/ocr", { requires: ["ocr"] })).status).toBe(422);
  });

  it("can switch a feature off without deleting it", async () => {
    await put("/features/ocr", { isActive: false });
    const f = (await get("/draft")).body.data.catalog.features.find((x: { key: string }) => x.key === "ocr");
    expect(f.isActive).toBe(false);
  });
});

describe("PUT /matrix", () => {
  it("replaces which features each fixed package includes", async () => {
    const res = await put("/matrix", { small: ["dashboard", "members"] });
    expect(res.status).toBe(200);
    const small = (await get("/draft")).body.data.catalog.packages.find((p: { code: string }) => p.code === "small");
    expect(small.features.sort()).toEqual(["dashboard", "members"]);
  });

  it("leaves packages not named in the request alone", async () => {
    await put("/matrix", { small: ["dashboard"] });
    const medium = (await get("/draft")).body.data.catalog.packages.find((p: { code: string }) => p.code === "medium");
    expect(medium.features).toContain("accounting_book");
  });

  it("rejects an unknown package, an unknown feature, and the Custom package", async () => {
    expect((await put("/matrix", { platinum: ["dashboard"] })).status).toBe(404);
    expect((await put("/matrix", { small: ["ghost"] })).status).toBe(422);
    expect((await put("/matrix", { custom: ["dashboard"] })).status).toBe(422);
  });
});

describe("PUT /addons, /support-plans, /settings", () => {
  it("updates volume add-on prices", async () => {
    const res = await put("/addons", [
      { itemKey: "MEMBERS", stepQty: 100, price: "600000", period: "YEARLY" },
      { itemKey: "USERS", stepQty: 1, price: "20000", period: "YEARLY" },
      { itemKey: "SAVING_TYPES", stepQty: 1, price: "5000", period: "YEARLY" },
      { itemKey: "LOAN_TYPES", stepQty: 1, price: "5000", period: "YEARLY" }
    ]);
    expect(res.status).toBe(200);
    const a = (await get("/draft")).body.data.catalog.volumeAddons.find((x: { itemKey: string }) => x.itemKey === "MEMBERS");
    expect(a.price).toBe("600000");
  });

  it("rejects a zero step quantity", async () => {
    expect((await put("/addons", [{ itemKey: "MEMBERS", stepQty: 0, price: "1", period: "YEARLY" }])).status).toBe(422);
  });

  it("updates a support plan", async () => {
    const res = await put("/support-plans", [{ code: "SP1", name: "SP.1", yearlyCost: "6000000", remote: true, onsite: true, visitsPerYear: 4, slaHours: 6, aiSupport: false }]);
    expect(res.status).toBe(200);
    const sp = (await get("/draft")).body.data.catalog.supportPlans.find((x: { code: string }) => x.code === "SP1");
    expect(sp.yearlyCost).toBe("6000000");
    expect((await get("/draft")).body.data.catalog.supportPlans).toHaveLength(3);
  });

  it("sets the VAT rate, payment instructions and grace days", async () => {
    const res = await put("/settings", { taxRate: "0.11", paymentInstructions: "Transfer ke BCA 123", paymentGraceDays: 10 });
    expect(res.status).toBe(200);
    const s = (await get("/draft")).body.data.catalog.settings;
    expect(s.taxRate).toBe("0.1100");
    expect(s.paymentInstructions).toBe("Transfer ke BCA 123");
    expect(s.paymentGraceDays).toBe(10);
  });

  it("rejects an out-of-range VAT rate and an unknown default package", async () => {
    expect((await put("/settings", { taxRate: "1.5" })).status).toBe(422);
    expect((await put("/settings", { defaultPackageCode: "platinum" })).status).toBe(422);
  });

  it("rejects enabling no billing cycle at all", async () => {
    expect((await put("/settings", { enabledCycles: [] })).status).toBe(422);
  });
});

describe("POST /quote (simulator)", () => {
  it("prices against the unpublished draft by default", async () => {
    await put("/packages/small", { priceMonthly: "600000", priceYearly: "6000000" });

    const draft = await post("/quote", { packageCode: "small", billingCycle: "MONTHLY" });
    const published = await post("/quote", { packageCode: "small", billingCycle: "MONTHLY", source: "published" });

    expect(draft.body.data.amountPerCycle).toBe("600000.00");
    expect(published.body.data.amountPerCycle).toBe("500000.00");
  });

  it("can quote hidden packages, unlike the public endpoint", async () => {
    await put("/packages/small", { isPublic: false });
    expect((await post("/quote", { packageCode: "small", billingCycle: "MONTHLY" })).status).toBe(200);
  });
});

describe("GET /diff and POST /publish", () => {
  it("shows what changed against the published version", async () => {
    await put("/packages/small", { priceMonthly: "600000", priceYearly: "6000000" });

    const res = await get("/diff");

    expect(res.body.data.fromVersion).toBe(1);
    expect(res.body.data.changes).toContainEqual({
      section: "packages",
      key: "small",
      type: "CHANGED",
      fields: expect.arrayContaining([{ field: "priceMonthly", before: "500000", after: "600000" }])
    });
  });

  it("refuses to publish when nothing changed", async () => {
    const res = await post("/publish");
    expect(res.status).toBe(409);
  });

  it("publishes the draft as the next version and updates the public catalog", async () => {
    await put("/packages/small", { priceMonthly: "600000", priceYearly: "6000000" });

    const res = await post("/publish", { note: "Naik harga Small" });

    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(2);
    const pub = await request(app()).get("/api/public/pricing");
    expect(pub.body.data.version).toBe(2);
    expect(pub.body.data.packages.find((p: { code: string }) => p.code === "small").priceMonthly).toBe("600000");
    const row = await db.pricingVersion.findUniqueOrThrow({ where: { version: 2 } });
    expect(row.publishedBy).toBe(adminId);
    expect((await db.pricingAuditLog.findFirstOrThrow({ where: { entity: "PricingVersion", action: "PUBLISH" } })).after).toMatchObject({ version: 2, note: "Naik harga Small" });
  });

  it("never rewrites an earlier version", async () => {
    await put("/packages/small", { priceMonthly: "600000", priceYearly: "6000000" });
    await post("/publish");

    const v1 = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
    expect((v1.snapshot as { packages: { code: string; priceMonthly: string }[] }).packages.find((p) => p.code === "small")?.priceMonthly).toBe("500000");
  });

  it("leaves an existing tenant's subscription snapshot untouched", async () => {
    const tenant = await setupTenant({ slug: "lama", registrationNo: "KOP-LAMA", adminEmail: "lama@demo.test" });
    const tenantId = tenant.user.tenantId;
    await request(app()).put(`/api/platform/tenants/${tenantId}/subscription`).set("Authorization", `Bearer ${token}`).send({ packageCode: "small", billingCycle: "MONTHLY" });
    await put("/packages/small", { priceMonthly: "600000", priceYearly: "6000000", limits: { members: 900, users: 10, savingTypes: 10, loanTypes: 10 } });
    await post("/publish");
    clearEntitlementCache();

    const ent = await getTenantEntitlements(tenantId);
    const sub = await withoutTenantScope(async () => db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } }));

    expect(ent?.limits.members).toBe(500);
    expect(sub.pricingVersion).toBe(1);
    expect(sub.amountPerCycle.toString()).toBe("500000");
  });

  it("refuses to publish a package that includes a feature without what it requires", async () => {
    await put("/matrix", { small: ["dashboard", "members", "reports", "period_closing"] });

    const res = await post("/publish");

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/small.*period_closing.*accounting_book/);
    expect(await db.pricingVersion.count()).toBe(1);
  });

  it("refuses to publish a draft that fails integrity checks", async () => {
    await db.subscriptionPackage.update({ where: { code: "small" }, data: { priceYearly: null } });

    const res = await post("/publish");

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/priceYearly/);
    expect(await db.pricingVersion.count()).toBe(1);
  });
});

describe("versions and rollback", () => {
  async function publishPriceChange() {
    await put("/packages/small", { priceMonthly: "600000", priceYearly: "6000000" });
    await post("/publish");
  }

  it("lists versions newest first", async () => {
    await publishPriceChange();
    const res = await get("/versions");
    expect(res.body.data.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    expect(res.body.data[0]).toMatchObject({ version: 2, publishedBy: adminId });
  });

  it("returns one version's catalog", async () => {
    await publishPriceChange();
    const res = await get("/versions/1");
    expect(res.body.data.catalog.packages.find((p: { code: string }) => p.code === "small").priceMonthly).toBe("500000");
    expect((await get("/versions/99")).status).toBe(404);
  });

  it("rolls back by restoring the draft and publishing it as a new version", async () => {
    await publishPriceChange();

    const res = await post("/rollback", { version: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data.version).toBe(3);
    const pub = await request(app()).get("/api/public/pricing");
    expect(pub.body.data.packages.find((p: { code: string }) => p.code === "small").priceMonthly).toBe("500000");
    expect(await db.pricingVersion.count()).toBe(3);
    expect((await get("/draft")).body.data.changeCount).toBe(0);
    expect((await db.pricingAuditLog.findFirstOrThrow({ where: { action: "ROLLBACK" } })).after).toMatchObject({ restoredFrom: 1, version: 3 });
  });

  it("answers 404 when rolling back to a version that does not exist", async () => {
    expect((await post("/rollback", { version: 42 })).status).toBe(404);
  });
});

describe("import and export", () => {
  it("exports the draft in the seed file shape", async () => {
    const res = await get("/export");

    expect(res.status).toBe(200);
    expect(() => parsePricingSeed(res.body.data)).not.toThrow();
    expect(res.body.data.packages).toHaveLength(5);
  });

  it("round-trips: importing an export changes nothing", async () => {
    const exported = (await get("/export")).body.data;

    const res = await post("/import", exported);

    expect(res.status).toBe(200);
    expect((await get("/diff")).body.data.changes).toEqual([]);
  });

  it("imports into the draft without publishing", async () => {
    const exported = (await get("/export")).body.data;
    exported.packages.find((p: { code: string }) => p.code === "small").priceMonthly = 700000;
    exported.packages.find((p: { code: string }) => p.code === "small").priceYearly = 7000000;

    await post("/import", exported);

    expect(await db.pricingVersion.count()).toBe(1);
    const small = (await get("/draft")).body.data.catalog.packages.find((p: { code: string }) => p.code === "small");
    expect(small.priceMonthly).toBe("700000");
    expect((await db.pricingAuditLog.findFirstOrThrow({ where: { action: "IMPORT" } })).actorId).toBe(adminId);
  });

  it("rejects an invalid file and leaves the draft as it was", async () => {
    const exported = (await get("/export")).body.data;
    exported.features[0].requires = ["ghost"];

    const res = await post("/import", exported);

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/ghost/);
    expect((await get("/diff")).body.data.changes).toEqual([]);
  });

  it("rejects an imported amount too large to store, and leaves the draft as it was", async () => {
    const exported = (await get("/export")).body.data;
    exported.packages.find((p: { code: string }) => p.code === "small").priceMonthly = 1e13;

    const res = await post("/import", exported);

    expect(res.status).toBe(422);
    expect((await get("/diff")).body.data.changes).toEqual([]);
  });

  it("deletes features that the imported file no longer has", async () => {
    const exported = (await get("/export")).body.data;
    exported.features = exported.features.filter((f: { key: string }) => f.key !== "ocr");

    await post("/import", exported);

    expect(await db.feature.count({ where: { key: "ocr" } })).toBe(0);
  });
});

describe("GET /audit", () => {
  it("lists changes newest first with the actor", async () => {
    await put("/packages/small", { name: "Small Plus" });
    await put("/features/ocr", { customPrice: "1100000" });

    const res = await get("/audit");

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ entity: "Feature", entityId: "ocr", actorId: adminId });
    expect(res.body.data.map((a: { entity: string }) => a.entity)).toContain("SubscriptionPackage");
  });
});

describe("tenant subscription (platform admin)", () => {
  const tenantSub = (id: string) => `/api/platform/tenants/${id}/subscription`;
  const putSub = (id: string, body: unknown) => request(app()).put(tenantSub(id)).set("Authorization", `Bearer ${token}`).send(body as object);

  async function aTenant(n: string) {
    const t = await setupTenant({ slug: `t-${n}`, registrationNo: `REG-${n}`, adminEmail: `${n}@demo.test` });
    return t.user.tenantId;
  }

  it("gives a tenant a subscription priced by the engine, and points the tenant at it", async () => {
    const tenantId = await aTenant("a");
    expect(await getTenantEntitlements(tenantId)).toBeNull();

    const res = await putSub(tenantId, { packageCode: "small", billingCycle: "MONTHLY" });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ packageCode: "small", status: "ACTIVE", amountPerCycle: "500000.00", pricingVersion: 1 });
    const sub = await withoutTenantScope(async () => db.tenantSubscription.findUniqueOrThrow({ where: { tenantId } }));
    expect(sub.createdVia).toBe("ADMIN");
    const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { package: true } });
    expect(tenant.package?.code).toBe("small");
    expect(tenant.nextBillingDate).not.toBeNull();
    // Entitlement cache is cleared, so the change is visible at once.
    expect((await getTenantEntitlements(tenantId))?.hasFeature("period_closing")).toBe(true);
  });

  it("switches a paid tenant to Free with no billing date", async () => {
    const tenantId = await aTenant("b");
    await putSub(tenantId, { packageCode: "small", billingCycle: "MONTHLY" });

    const res = await putSub(tenantId, { packageCode: "free", billingCycle: "MONTHLY" });

    expect(res.body.data.amountPerCycle).toBe("0.00");
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).nextBillingDate).toBeNull();
  });

  it("stores limit overrides and reflects them in entitlements", async () => {
    const tenantId = await aTenant("c");

    await putSub(tenantId, { packageCode: "free", billingCycle: "MONTHLY", limitOverrides: { members: 70 } });

    expect((await getTenantEntitlements(tenantId))?.limits.members).toBe(70);
  });

  it("builds a Custom subscription from chosen features", async () => {
    const tenantId = await aTenant("d");

    const res = await putSub(tenantId, { packageCode: "custom", billingCycle: "MONTHLY", featureKeys: ["unit_konsumen", "unit_pasar", "reports_market"] });

    expect(res.body.data.amountPerCycle).toBe("400000.00");
    expect((await getTenantEntitlements(tenantId))?.hasFeature("reports_market")).toBe(true);
  });

  it("keeps the nextBillingDate the admin sets", async () => {
    const tenantId = await aTenant("e");
    await putSub(tenantId, { packageCode: "small", billingCycle: "MONTHLY", nextBillingDate: "2027-03-01T00:00:00.000Z" });
    expect((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).nextBillingDate?.toISOString()).toBe("2027-03-01T00:00:00.000Z");
  });

  it("audits the change with before and after", async () => {
    const tenantId = await aTenant("f");
    await putSub(tenantId, { packageCode: "small", billingCycle: "MONTHLY" });
    await putSub(tenantId, { packageCode: "medium", billingCycle: "YEARLY" });

    const rows = await db.pricingAuditLog.findMany({ where: { entity: "TenantSubscription", entityId: tenantId }, orderBy: { at: "asc" } });

    expect(rows).toHaveLength(2);
    expect(rows[1]!.before).toMatchObject({ packageCode: "small" });
    expect(rows[1]!.after).toMatchObject({ packageCode: "medium", billingCycle: "YEARLY" });
    expect(rows[1]!.actorId).toBe(adminId);
  });

  it("rejects an unknown tenant, an unknown package and a bad selection", async () => {
    const tenantId = await aTenant("g");
    expect((await putSub("no-such-tenant", { packageCode: "small", billingCycle: "MONTHLY" })).status).toBe(404);
    expect((await putSub(tenantId, { packageCode: "platinum", billingCycle: "MONTHLY" })).status).toBe(422);
    expect((await putSub(tenantId, { packageCode: "custom", billingCycle: "MONTHLY", featureKeys: ["reports_market"] })).status).toBe(422);
  });

  it("does not touch another tenant's subscription", async () => {
    const a = await aTenant("h");
    const b = await aTenant("i");
    await putSub(a, { packageCode: "small", billingCycle: "MONTHLY" });
    await putSub(b, { packageCode: "free", billingCycle: "MONTHLY" });

    await putSub(a, { packageCode: "medium", billingCycle: "MONTHLY" });

    expect((await getTenantEntitlements(b))?.packageCode).toBe("free");
  });

  it("reads back a tenant's subscription with usage against limits", async () => {
    const tenantId = await aTenant("j");
    await putSub(tenantId, { packageCode: "free", billingCycle: "MONTHLY", limitOverrides: { members: 70 } });

    const res = await request(app()).get(tenantSub(tenantId)).set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.subscription).toMatchObject({ packageCode: "free", status: "ACTIVE", limitOverrides: { members: 70 } });
    expect(res.body.data.limits.members).toBe(70);
    expect(res.body.data.usage).toMatchObject({ members: 0, users: 1 });
  });

  it("returns null subscription for a tenant that has none", async () => {
    const tenantId = await aTenant("k");
    const res = await request(app()).get(tenantSub(tenantId)).set("Authorization", `Bearer ${token}`);
    expect(res.body.data.subscription).toBeNull();
  });

  it("is closed to tenant admins", async () => {
    const t = await setupTenant({ slug: "t-z", registrationNo: "REG-Z", adminEmail: "z@demo.test" });
    const res = await request(app()).put(tenantSub(t.user.tenantId)).set("Authorization", `Bearer ${t.accessToken}`).send({ packageCode: "small", billingCycle: "MONTHLY" });
    expect(res.status).toBe(403);
  });
});
