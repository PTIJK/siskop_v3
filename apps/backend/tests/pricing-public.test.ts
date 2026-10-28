import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ErrorCode } from "@siskop/types";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { buildSubscriptionSnapshot } from "../src/lib/pricing/engine.js";
import { clearCatalogCache } from "../src/lib/pricing/catalog.js";
import { clearEntitlementCache } from "../src/lib/pricing/entitlements.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import type { CatalogSnapshot } from "../src/lib/pricing/snapshot.js";
import { app, setupTenant } from "./helpers.js";

const SEED_PATH = resolve(__dirname, "../../../docs/package-modules/pricing.seed.json");

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

beforeAll(resetCatalog);
beforeEach(async () => {
  clearCatalogCache();
  clearEntitlementCache();
  if ((await db.pricingVersion.count()) === 0) {
    await loadPricingSeed(db, parsePricingSeed(JSON.parse(readFileSync(SEED_PATH, "utf8"))));
  }
});
afterEach(async () => {
  await db.pricingVersion.deleteMany({ where: { version: { gt: 1 } } });
  await db.tenant.deleteMany({});
  clearCatalogCache();
});

const publishV2 = async (mutate: (s: CatalogSnapshot) => void) => {
  const v1 = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
  const snapshot = structuredClone(v1.snapshot) as unknown as CatalogSnapshot;
  mutate(snapshot);
  await db.pricingVersion.create({ data: { version: 2, snapshot: snapshot as never } });
  clearCatalogCache();
};

describe("GET /api/public/pricing", () => {
  it("returns the latest published catalog in the API envelope, without any auth", async () => {
    const res = await request(app()).get("/api/public/pricing");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.currency).toBe("IDR");
    expect(res.body.data.packages.map((p: { code: string }) => p.code)).toEqual(["free", "small", "medium", "enterprise", "custom"]);
    expect(res.body.data.packages[1]).toMatchObject({ code: "small", priceMonthly: "500000", priceYearly: "5000000" });
    expect(res.body.data.supportPlans).toHaveLength(3);
    expect(res.body.data.volumeAddons).toHaveLength(4);
    expect(res.headers["cache-control"]).toMatch(/public/);
  });

  it("does not expose payment or operational settings", async () => {
    const res = await request(app()).get("/api/public/pricing");

    const keys = Object.keys(res.body.data.settings);
    expect(keys).not.toContain("paymentInstructions");
    expect(keys).not.toContain("paymentGraceDays");
    expect(keys).not.toContain("unpaidRegistrationPurgeDays");
    expect(keys).not.toContain("paymentProvider");
    expect(keys).not.toContain("oneFreeTenantPerRegistrationNo");
    expect(res.body.data.settings.taxRate).toBeNull();
  });

  it("serves the newest published version and hides non-public packages", async () => {
    await publishV2((s) => {
      s.packages.find((p) => p.code === "small")!.isPublic = false;
    });

    const res = await request(app()).get("/api/public/pricing");

    expect(res.body.data.version).toBe(2);
    expect(res.body.data.packages.map((p: { code: string }) => p.code)).not.toContain("small");
  });

  it("ignores edits to the live draft tables until the owner publishes", async () => {
    await db.feature.update({ where: { key: "ocr" }, data: { customPrice: 1 } });

    const res = await request(app()).get("/api/public/pricing");

    expect(res.body.data.features.find((f: { key: string }) => f.key === "ocr").customPrice).toBe("1000000");
    await db.feature.update({ where: { key: "ocr" }, data: { customPrice: 1_000_000 } });
  });

  it("answers 404 until something has been published", async () => {
    await db.pricingVersion.deleteMany({});
    clearCatalogCache();

    const res = await request(app()).get("/api/public/pricing");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(ErrorCode.NOT_FOUND);
    await loadPricingSeed(db, parsePricingSeed(JSON.parse(readFileSync(SEED_PATH, "utf8"))));
  });
});

describe("POST /api/public/pricing/quote", () => {
  const post = (body: unknown) => request(app()).post("/api/public/pricing/quote").send(body as object);

  it("quotes Small monthly at 500,000", async () => {
    const res = await post({ packageCode: "small", billingCycle: "MONTHLY" });

    expect(res.status).toBe(200);
    expect(res.body.data.amountPerCycle).toBe("500000.00");
    expect(res.body.data.pricingVersion).toBe(1);
  });

  it("quotes a Custom selection at 400,000 a month and returns the effective access", async () => {
    const res = await post({ packageCode: "custom", billingCycle: "MONTHLY", featureKeys: ["unit_konsumen", "unit_pasar", "reports_market"] });

    expect(res.status).toBe(200);
    expect(res.body.data.amountPerCycle).toBe("400000.00");
    expect(res.body.data.effectiveFeatures).toContain("reports_market");
    expect(res.body.data.effectiveLimits).toEqual({ members: 50, users: 1, savingTypes: 2, loanTypes: 2 });
  });

  it("rejects a client-supplied price instead of trusting it", async () => {
    const res = await post({ packageCode: "small", billingCycle: "MONTHLY", amountPerCycle: "1.00" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe(ErrorCode.VALIDATION_ERROR);
  });

  it("rejects a selection missing a required feature with 422", async () => {
    const res = await post({ packageCode: "custom", billingCycle: "MONTHLY", featureKeys: ["reports_market"] });

    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/unit_pasar/);
  });

  it("rejects unknown packages, bad cycles and bad quantities", async () => {
    expect((await post({ packageCode: "platinum", billingCycle: "MONTHLY" })).status).toBe(422);
    expect((await post({ packageCode: "small", billingCycle: "WEEKLY" })).status).toBe(422);
    expect((await post({ packageCode: "small", billingCycle: "MONTHLY", addons: [{ itemKey: "MEMBERS", qty: -1 }] })).status).toBe(422);
  });

  it("will not quote a package the owner has hidden", async () => {
    await publishV2((s) => {
      s.packages.find((p) => p.code === "small")!.isPublic = false;
    });

    const res = await post({ packageCode: "small", billingCycle: "MONTHLY" });

    expect(res.status).toBe(422);
  });

  it("is rate limited", async () => {
    const server = app();
    let last = 0;
    for (let i = 0; i < 40; i += 1) {
      last = (await request(server).post("/api/public/pricing/quote").send({ packageCode: "free", billingCycle: "MONTHLY" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("GET /api/config/subscription", () => {
  it("requires authentication", async () => {
    expect((await request(app()).get("/api/config/subscription")).status).toBe(401);
  });

  it("returns null data for a tenant that has no subscription yet", async () => {
    const session = await setupTenant();

    const res = await request(app()).get("/api/config/subscription").set("Authorization", `Bearer ${session.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });

  it("returns the tenant's own features, effective limits and usage", async () => {
    const session = await setupTenant();
    const v = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
    const snapshot = buildSubscriptionSnapshot(
      { packageCode: "small", billingCycle: "MONTHLY" },
      { version: 1, snapshot: v.snapshot as unknown as CatalogSnapshot }
    );
    const pkg = await db.subscriptionPackage.findUniqueOrThrow({ where: { code: "small" } });
    await db.tenantSubscription.create({
      data: {
        tenantId: session.user.tenantId,
        packageId: pkg.id,
        pricingVersion: 1,
        billingCycle: "MONTHLY",
        snapshot: snapshot as never,
        amountPerCycle: 500_000,
        status: "ACTIVE",
        startsAt: new Date(),
        nextBillingDate: new Date("2026-12-01T00:00:00.000Z"),
        createdVia: "ADMIN",
        limitOverrides: { members: 650 }
      }
    });

    const res = await request(app()).get("/api/config/subscription").set("Authorization", `Bearer ${session.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      packageCode: "small",
      packageName: "Small",
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      nextBillingDate: "2026-12-01T00:00:00.000Z",
      limits: { members: 650, users: 10, savingTypes: 10, loanTypes: 10 },
      usage: { members: 0, users: 1, savingTypes: 0, loanTypes: 0 }
    });
    expect(res.body.data.features).toContain("period_closing");
    expect(res.body.data.features).not.toContain("manual_journal");
  });
});
