import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/lib/db.js";
import { diffCatalogs } from "../src/lib/pricing/diff.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import type { CatalogSnapshot } from "../src/lib/pricing/snapshot.js";
import { snapshotToSeed } from "../src/lib/pricing/transform.js";
import { seedJson } from "./pricing-fixture.js";

let v1: CatalogSnapshot;

beforeAll(async () => {
  await db.packageFeature.deleteMany({});
  await db.feature.deleteMany({});
  await db.subscriptionPackage.deleteMany({ where: { code: { not: null } } });
  await db.volumeAddon.deleteMany({});
  await db.supportPlan.deleteMany({});
  await db.pricingSetting.deleteMany({});
  await db.pricingVersion.deleteMany({});
  await db.pricingAuditLog.deleteMany({});
  await loadPricingSeed(db, parsePricingSeed(seedJson()));
  v1 = (await db.pricingVersion.findUniqueOrThrow({ where: { version: 1 } })).snapshot as unknown as CatalogSnapshot;
});

const copy = () => structuredClone(v1);

describe("diffCatalogs", () => {
  it("reports nothing for identical catalogs", () => {
    expect(diffCatalogs(v1, copy())).toEqual([]);
  });

  it("ignores key order inside nested objects, because Postgres jsonb reorders keys", () => {
    const next = copy();
    const small = next.packages.find((p) => p.code === "small")!;
    const { members, users, savingTypes, loanTypes } = small.limits;
    small.limits = { loanTypes, savingTypes, users, members };

    expect(diffCatalogs(v1, next)).toEqual([]);
  });

  it("reports a changed package field with before and after", () => {
    const next = copy();
    next.packages.find((p) => p.code === "small")!.priceMonthly = "600000";

    expect(diffCatalogs(v1, next)).toEqual([
      { section: "packages", key: "small", type: "CHANGED", fields: [{ field: "priceMonthly", before: "500000", after: "600000" }] }
    ]);
  });

  it("reports a feature added to and removed from a package as a change to its feature list", () => {
    const next = copy();
    const small = next.packages.find((p) => p.code === "small")!;
    small.features = small.features.filter((k) => k !== "period_closing");

    const [change] = diffCatalogs(v1, next);

    expect(change).toMatchObject({ section: "packages", key: "small", type: "CHANGED" });
    expect(change!.fields).toEqual([{ field: "features", before: expect.arrayContaining(["period_closing"]), after: expect.not.arrayContaining(["period_closing"]) }]);
  });

  it("reports added and removed entities", () => {
    const next = copy();
    next.features = next.features.filter((f) => f.key !== "ocr");
    next.supportPlans.push({ code: "SP3", name: "SP.3", yearlyCost: "30000000", remote: true, onsite: true, visitsPerYear: 24, slaHours: 1, aiSupport: true });

    const changes = diffCatalogs(v1, next);

    expect(changes).toContainEqual({ section: "features", key: "ocr", type: "REMOVED" });
    expect(changes).toContainEqual({ section: "supportPlans", key: "SP3", type: "ADDED" });
  });

  it("reports settings changes field by field", () => {
    const next = copy();
    next.settings.taxRate = "0.1100";
    next.settings.paymentGraceDays = 10;

    const [change] = diffCatalogs(v1, next);

    expect(change).toMatchObject({ section: "settings", key: "settings", type: "CHANGED" });
    expect(change!.fields).toEqual(
      expect.arrayContaining([
        { field: "taxRate", before: null, after: "0.1100" },
        { field: "paymentGraceDays", before: 7, after: 10 }
      ])
    );
  });
});

describe("snapshotToSeed", () => {
  it("produces a seed that parsePricingSeed accepts, so export and import share one shape", () => {
    const seed = snapshotToSeed(v1, 7);

    const parsed = parsePricingSeed(seed);

    expect(parsed.version).toBe(7);
    expect(parsed.packages.map((p) => p.code)).toEqual(["free", "small", "medium", "enterprise", "custom"]);
  });

  it("derives includedIn from each package's feature list and omits Custom", () => {
    const seed = parsePricingSeed(snapshotToSeed(v1, 1));

    expect(seed.features.find((f) => f.key === "period_closing")?.includedIn).toEqual(["small", "medium", "enterprise"]);
    expect(seed.features.every((f) => !f.includedIn.includes("custom"))).toBe(true);
  });

  it("round-trips: a seed made from a snapshot loads back to the same snapshot", async () => {
    const seed = parsePricingSeed(snapshotToSeed(v1, 2));
    await db.packageFeature.deleteMany({});
    await db.feature.deleteMany({});
    await db.subscriptionPackage.deleteMany({ where: { code: { not: null } } });
    await db.volumeAddon.deleteMany({});
    await db.supportPlan.deleteMany({});
    await db.pricingSetting.deleteMany({});
    await db.pricingVersion.deleteMany({});

    await loadPricingSeed(db, seed);

    const v2 = (await db.pricingVersion.findUniqueOrThrow({ where: { version: 2 } })).snapshot as unknown as CatalogSnapshot;
    expect(diffCatalogs(v1, v2)).toEqual([]);
  });
});
