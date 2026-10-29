import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { withoutTenantScope } from "../src/lib/tenant-scope.js";
import { quote } from "../src/lib/pricing/engine.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import type { CatalogSnapshot } from "../src/lib/pricing/snapshot.js";

const SEED_PATH = resolve(__dirname, "../../../docs/package-modules/pricing.seed.json");
const rawSeed = (): unknown => JSON.parse(readFileSync(SEED_PATH, "utf8"));

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

beforeEach(resetCatalog);

describe("loadPricingSeed", () => {
  it("creates the five packages with Decimal prices and null = unlimited limits", async () => {
    await loadPricingSeed(db, parsePricingSeed(rawSeed()));

    const pkgs = await db.subscriptionPackage.findMany({ where: { code: { not: null } }, orderBy: { sortOrder: "asc" } });
    expect(pkgs.map((p) => p.code)).toEqual(["free", "small", "medium", "enterprise", "custom"]);

    const free = pkgs[0]!;
    expect(free.priceMonthly).toBeNull();
    expect(free.priceYearly).toBeNull();
    expect(free.price.toString()).toBe("0");
    expect([free.maxMembers, free.maxUsers, free.maxSavingTypes, free.maxLoanTypes]).toEqual([50, 1, 2, 2]);
    expect(free.isPublic).toBe(true);

    const small = pkgs[1]!;
    expect(small.priceMonthly).toBeInstanceOf(Prisma.Decimal);
    expect(small.priceMonthly!.toString()).toBe("500000");
    expect(small.priceYearly!.toString()).toBe("5000000");

    const enterprise = pkgs[3]!;
    expect(enterprise.priceYearly!.toString()).toBe("23500000");
    expect([enterprise.maxMembers, enterprise.maxUsers, enterprise.maxSavingTypes, enterprise.maxLoanTypes]).toEqual([3000, null, null, null]);

    const custom = pkgs[4]!;
    expect(custom.isCustom).toBe(true);
    expect([custom.maxMembers, custom.maxUsers, custom.maxSavingTypes, custom.maxLoanTypes]).toEqual([null, null, null, null]);
  });

  it("stores every feature with its parent link, requires list and price group", async () => {
    const seed = parsePricingSeed(rawSeed());
    await loadPricingSeed(db, seed);

    expect(await db.feature.count()).toBe(seed.features.length);
    const ksp = await db.feature.findUniqueOrThrow({ where: { key: "unit_ksp" }, include: { parent: true } });
    expect(ksp.parent?.key).toBe("unit_business");
    const market = await db.feature.findUniqueOrThrow({ where: { key: "reports_market" } });
    expect(market.requires).toEqual(["unit_pasar"]);
    const wl = await db.feature.findUniqueOrThrow({ where: { key: "whitelabel" } });
    expect(wl.priceGroup).toBe("whitelabel_workspace");
    expect(wl.customPrice.toString()).toBe("1000000");
  });

  it("links fixed packages to their matrix features and gives Custom none", async () => {
    await loadPricingSeed(db, parsePricingSeed(rawSeed()));

    const keysOf = async (code: string) =>
      (await db.packageFeature.findMany({ where: { package: { code } }, include: { feature: true } })).map((pf) => pf.feature.key);

    const free = await keysOf("free");
    expect(free).toContain("config_coa");
    expect(free).not.toContain("accounting_book");
    expect(await keysOf("small")).toContain("period_closing");
    expect(await keysOf("small")).not.toContain("manual_journal");
    expect(await keysOf("enterprise")).toContain("ocr");
    expect(await keysOf("custom")).toEqual([]);
  });

  it("matches the golden sanity totals from the spec", async () => {
    await loadPricingSeed(db, parsePricingSeed(rawSeed()));

    const medium = await db.packageFeature.findMany({ where: { package: { code: "medium" } }, include: { feature: true } });
    const mediumOneByOne = medium.reduce((sum, pf) => sum.plus(pf.feature.customPrice), new Prisma.Decimal(0));
    expect(mediumOneByOne.toString()).toBe("1700000");

    const all = await db.feature.findMany();
    const grouped = new Map<string, Prisma.Decimal>();
    let total = new Prisma.Decimal(0);
    for (const f of all) {
      if (f.priceGroup) grouped.set(f.priceGroup, f.customPrice);
      else total = total.plus(f.customPrice);
    }
    for (const price of grouped.values()) total = total.plus(price);
    // whitelabel + workspace_address count once, not twice.
    expect(total.toString()).toBe("6550000");
  });

  it("ships PPN at 11% so quotes include VAT by default", async () => {
    await loadPricingSeed(db, parsePricingSeed(rawSeed()));

    const setting = await db.pricingSetting.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(setting.taxRate?.toString()).toBe("0.11");
    const v = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
    const q = quote({ packageCode: "small", billingCycle: "MONTHLY" }, { version: 1, snapshot: v.snapshot as unknown as CatalogSnapshot });
    expect([q.taxRate, q.amountPerCycle, q.taxAmount, q.total]).toEqual(["0.1100", "500000.00", "55000.00", "555000.00"]);
  });

  it("stores settings with the remaining owner inputs left null", async () => {
    await loadPricingSeed(db, parsePricingSeed(rawSeed()));

    const s = await db.pricingSetting.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(s.yearlyMultiplier).toBe(10);
    expect(s.enabledCycles).toEqual(["MONTHLY", "YEARLY"]);
    expect(s.defaultPackageCode).toBe("free");
    expect(s.paymentGraceDays).toBe(7);
    expect(s.unpaidRegistrationPurgeDays).toBe(14);
    expect(s.taxRate?.toString()).toBe("0.11");
    expect(s.paymentInstructions).toBeNull();
    expect(s.customBaseLimits).toEqual({ members: 50, users: 1, savingTypes: 2, loanTypes: 2 });
  });

  it("stores volume add-ons and support plans", async () => {
    await loadPricingSeed(db, parsePricingSeed(rawSeed()));

    const members = await db.volumeAddon.findUniqueOrThrow({ where: { itemKey: "MEMBERS" } });
    expect([members.stepQty, members.price.toString(), members.period]).toEqual([100, "500000", "YEARLY"]);
    const sp2 = await db.supportPlan.findUniqueOrThrow({ where: { code: "SP2" } });
    expect([sp2.yearlyCost.toString(), sp2.visitsPerYear, sp2.slaHours, sp2.aiSupport]).toEqual(["15000000", 12, 3, true]);
    expect((await db.supportPlan.findUniqueOrThrow({ where: { code: "SP0" } })).slaHours).toBeNull();
  });

  it("publishes the seed as an immutable PricingVersion snapshot with string money", async () => {
    await loadPricingSeed(db, parsePricingSeed(rawSeed()), { actorId: "platform-admin-1" });

    const v = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
    expect(v.publishedBy).toBe("platform-admin-1");
    const snap = v.snapshot as {
      packages: { code: string; priceMonthly: string | null; features: string[] }[];
      features: { key: string; customPrice: string }[];
      volumeAddons: { itemKey: string; price: string }[];
      supportPlans: { code: string }[];
      settings: { taxRate: string | null };
    };
    expect(snap.packages.find((p) => p.code === "small")?.priceMonthly).toBe("500000");
    expect(snap.packages.find((p) => p.code === "free")?.priceMonthly).toBeNull();
    expect(snap.packages.find((p) => p.code === "small")?.features).toContain("period_closing");
    expect(snap.features.find((f) => f.key === "ocr")?.customPrice).toBe("1000000");
    expect(snap.volumeAddons).toHaveLength(4);
    expect(snap.supportPlans.map((s) => s.code)).toEqual(["SP0", "SP1", "SP2"]);
    expect(snap.settings.taxRate).toBe("0.1100");
  });

  it("is idempotent and never rewrites an already published version", async () => {
    const seed = parsePricingSeed(rawSeed());
    await loadPricingSeed(db, seed);
    const first = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
    await db.feature.update({ where: { key: "ocr" }, data: { customPrice: 1 } });

    await loadPricingSeed(db, seed);

    expect(await db.pricingVersion.count()).toBe(1);
    expect(await db.feature.count()).toBe(seed.features.length);
    expect(await db.subscriptionPackage.count({ where: { code: { not: null } } })).toBe(5);
    expect(await db.packageFeature.count()).toBe(
      seed.packages.reduce((n, p) => n + seed.features.filter((f) => f.includedIn.includes(p.code)).length, 0)
    );
    const again = await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } });
    expect(again.snapshot).toEqual(first.snapshot);
  });

  it("writes an audit log row for the seed run", async () => {
    await loadPricingSeed(db, parsePricingSeed(rawSeed()), { actorId: "owner-1" });

    const rows = await db.pricingAuditLog.findMany({ where: { entity: "PricingVersion" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: "owner-1", action: "SEED_PUBLISH", entityId: "1" });
  });
});

describe("parsePricingSeed", () => {
  const mutate = (fn: (seed: any) => void) => {
    const seed = rawSeed() as any;
    fn(seed);
    return seed;
  };

  it("rejects a requires key that is not a feature", () => {
    expect(() => parsePricingSeed(mutate((s) => (s.features[0].requires = ["nope"])))).toThrow(/nope/);
  });

  it("rejects a parentKey that is not a feature", () => {
    expect(() => parsePricingSeed(mutate((s) => (s.features[1].parentKey = "ghost")))).toThrow(/ghost/);
  });

  it("rejects includedIn naming an unknown package", () => {
    expect(() => parsePricingSeed(mutate((s) => s.features[0].includedIn.push("platinum")))).toThrow(/platinum/);
  });

  it("rejects includedIn naming the Custom package, which is priced per feature", () => {
    expect(() => parsePricingSeed(mutate((s) => s.features[0].includedIn.push("custom")))).toThrow(/custom/);
  });

  it("rejects a package that includes a feature without a feature it requires", () => {
    const bad = mutate((s) => {
      const f = s.features.find((x: { key: string }) => x.key === "period_closing");
      f.includedIn = [...f.includedIn];
      s.features.find((x: { key: string }) => x.key === "accounting_book").includedIn = ["medium", "enterprise"];
    });
    expect(() => parsePricingSeed(bad)).toThrow(/small.*period_closing.*accounting_book/);
  });

  it("rejects a package that includes a feature without its parent", () => {
    const bad = mutate((s) => {
      s.features.find((x: { key: string }) => x.key === "reports").includedIn = ["free", "medium", "enterprise"];
    });
    expect(() => parsePricingSeed(bad)).toThrow(/small.*reports_regulatory.*reports/);
  });

  it("rejects a fixed package priced monthly without a yearly price", () => {
    expect(() => parsePricingSeed(mutate((s) => (s.packages[1].priceYearly = null)))).toThrow(/priceYearly/);
  });

  it("writes nothing when the seed is invalid", async () => {
    const bad = mutate((s) => (s.features[0].requires = ["nope"]));
    expect(() => parsePricingSeed(bad)).toThrow();
    expect(await db.feature.count()).toBe(0);
  });
});
