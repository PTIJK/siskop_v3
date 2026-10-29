import { beforeAll, describe, expect, it } from "vitest";
import { ErrorCode, type PricingSelection } from "@siskop/types";
import { db } from "../src/lib/db.js";
import { buildSubscriptionSnapshot, quote, resolveEntitlements, validateSelection } from "../src/lib/pricing/engine.js";
import { loadPricingSeed, parsePricingSeed } from "../src/lib/pricing/seed.js";
import type { CatalogSnapshot } from "../src/lib/pricing/snapshot.js";
import { AppError } from "../src/lib/errors.js";
import { seedJson } from "./pricing-fixture.js";


let published: { version: number; snapshot: CatalogSnapshot };

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
  const v = await db.pricingVersion.findFirstOrThrow({ orderBy: { version: "desc" } });
  published = { version: v.version, snapshot: v.snapshot as unknown as CatalogSnapshot };
});

const clone = (): { version: number; snapshot: CatalogSnapshot } => ({
  version: published.version,
  snapshot: structuredClone(published.snapshot)
});
const sel = (over: Partial<PricingSelection>): PricingSelection => ({ packageCode: "free", billingCycle: "MONTHLY", ...over });
const rejects = (fn: () => unknown, pattern: RegExp) => {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(ErrorCode.VALIDATION_ERROR);
    expect((err as AppError).message).toMatch(pattern);
    return;
  }
  throw new Error("expected validation to throw");
};

describe("quote: fixed packages", () => {
  it("prices Free at zero", () => {
    const q = quote(sel({ packageCode: "free" }), published);
    expect(q.amountPerCycle).toBe("0.00");
    expect(q.total).toBe("0.00");
    expect(q.pricingVersion).toBe(1);
  });

  it("Small monthly is 500,000", () => {
    expect(quote(sel({ packageCode: "small" }), published).amountPerCycle).toBe("500000.00");
  });

  it("Medium yearly is 10,000,000", () => {
    expect(quote(sel({ packageCode: "medium", billingCycle: "YEARLY" }), published).amountPerCycle).toBe("10000000.00");
  });

  it("Enterprise yearly is 23,500,000", () => {
    expect(quote(sel({ packageCode: "enterprise", billingCycle: "YEARLY" }), published).amountPerCycle).toBe("23500000.00");
  });
});

describe("quote: volume add-ons", () => {
  it("charges whole steps, quoted yearly: 150 extra members = 2 steps = 1,000,000 a year", () => {
    const q = quote(sel({ packageCode: "small", billingCycle: "YEARLY", addons: [{ itemKey: "MEMBERS", qty: 150 }] }), published);
    expect(q.amountPerCycle).toBe("6000000.00");
    expect(q.lines.find((l) => l.kind === "ADDON")).toMatchObject({ key: "MEMBERS", qty: 150, amount: "1000000.00" });
  });

  it("monthly-billed tenants pay one twelfth of the yearly add-on price", () => {
    const q = quote(sel({ packageCode: "small", billingCycle: "MONTHLY", addons: [{ itemKey: "MEMBERS", qty: 200 }] }), published);
    expect(q.lines.find((l) => l.kind === "ADDON")?.amount).toBe("83333.33");
    expect(q.amountPerCycle).toBe("583333.33");
  });

  it("raises effective limits by the quantity bought, and leaves unlimited unlimited", () => {
    const small = quote(sel({ packageCode: "small", addons: [{ itemKey: "MEMBERS", qty: 200 }, { itemKey: "USERS", qty: 3 }] }), published);
    expect(small.effectiveLimits).toEqual({ members: 700, users: 13, savingTypes: 10, loanTypes: 10 });
    const ent = quote(sel({ packageCode: "enterprise", addons: [{ itemKey: "USERS", qty: 5 }] }), published);
    expect(ent.effectiveLimits.users).toBeNull();
    expect(ent.effectiveLimits.members).toBe(3000);
  });
});

describe("quote: Custom package", () => {
  it("Konsumen + Pasar + Laporan pasar is 400,000 a month", () => {
    const q = quote(sel({ packageCode: "custom", featureKeys: ["unit_konsumen", "unit_pasar", "reports_market"] }), published);
    expect(q.amountPerCycle).toBe("400000.00");
  });

  it("charges Whitelabel + Workspace address once as a price group: 1,000,000, not 2,000,000", () => {
    const q = quote(sel({ packageCode: "custom", featureKeys: ["whitelabel", "workspace_address"] }), published);
    expect(q.amountPerCycle).toBe("1000000.00");
  });

  it("yearly is monthly times the yearly multiplier", () => {
    const q = quote(sel({ packageCode: "custom", billingCycle: "YEARLY", featureKeys: ["unit_konsumen", "unit_pasar", "reports_market"] }), published);
    expect(q.amountPerCycle).toBe("4000000.00");
  });

  it("starts from the base limits and the free-included features", () => {
    const q = quote(sel({ packageCode: "custom", featureKeys: ["unit_pasar"], addons: [{ itemKey: "MEMBERS", qty: 100 }] }), published);
    expect(q.effectiveLimits).toEqual({ members: 150, users: 1, savingTypes: 2, loanTypes: 2 });
    expect(q.effectiveFeatures).toContain("dashboard");
    expect(q.effectiveFeatures).toContain("unit_pasar");
    expect(q.effectiveFeatures).not.toContain("unit_konsumen");
  });

  it("prices every priced feature together at 6,550,000 a month", () => {
    const priced = published.snapshot.features.filter((f) => Number(f.customPrice) > 0).map((f) => f.key);
    const q = quote(sel({ packageCode: "custom", featureKeys: priced }), published);
    expect(q.amountPerCycle).toBe("6550000.00");
  });
});

describe("quote: support plan and VAT", () => {
  it("adds the yearly support fee once, separate from the recurring amount", () => {
    const q = quote(sel({ packageCode: "small", supportPlanCode: "SP1" }), published);
    expect(q.amountPerCycle).toBe("500000.00");
    expect(q.supportYearly).toBe("5000000.00");
    expect(q.subtotal).toBe("5500000.00");
    expect(q.lines.at(-1)).toMatchObject({ kind: "SUPPORT", key: "SP1", amount: "5000000.00" });
  });

  it("leaves VAT out until the owner sets a rate", () => {
    const q = quote(sel({ packageCode: "small" }), published);
    expect(q.taxRate).toBeNull();
    expect(q.taxAmount).toBe("0.00");
    expect(q.total).toBe("500000.00");
  });

  it("applies the owner's VAT rate on top of the subtotal", () => {
    const withTax = clone();
    withTax.snapshot.settings.taxRate = "0.1100";
    const q = quote(sel({ packageCode: "small" }), withTax);
    expect(q.taxRate).toBe("0.1100");
    expect(q.taxAmount).toBe("55000.00");
    expect(q.total).toBe("555000.00");
  });
});

describe("validateSelection", () => {
  it("rejects an unknown package", () => rejects(() => validateSelection(sel({ packageCode: "platinum" }), published), /platinum/));

  it("rejects a billing cycle the owner has not enabled", () => {
    const monthlyOnly = clone();
    monthlyOnly.snapshot.settings.enabledCycles = ["MONTHLY"];
    rejects(() => validateSelection(sel({ packageCode: "small", billingCycle: "YEARLY" }), monthlyOnly), /YEARLY/);
  });

  it("rejects Custom when the owner has switched it off", () => {
    const off = clone();
    off.snapshot.settings.customEnabled = false;
    rejects(() => validateSelection(sel({ packageCode: "custom" }), off), /custom/i);
  });

  it("rejects a non-public package when asked for public only", () => {
    const hidden = clone();
    hidden.snapshot.packages.find((p) => p.code === "small")!.isPublic = false;
    rejects(() => validateSelection(sel({ packageCode: "small" }), hidden, { publicOnly: true }), /small/);
    expect(() => validateSelection(sel({ packageCode: "small" }), hidden)).not.toThrow();
  });

  it("rejects an unknown feature key", () => rejects(() => validateSelection(sel({ packageCode: "custom", featureKeys: ["teleport"] }), published), /teleport/));

  it("rejects a feature whose requires is missing", () =>
    rejects(() => validateSelection(sel({ packageCode: "custom", featureKeys: ["reports_market"] }), published), /unit_pasar/));

  it("accepts a requires satisfied by another selected feature", () => {
    expect(() => validateSelection(sel({ packageCode: "custom", featureKeys: ["reports_market", "unit_pasar"] }), published)).not.toThrow();
  });

  it("rejects a feature whose priced parent is missing", () => {
    const pricedParent = clone();
    pricedParent.snapshot.features.find((f) => f.key === "unit_business")!.customPrice = "50000.00";
    rejects(() => validateSelection(sel({ packageCode: "custom", featureKeys: ["unit_konsumen"] }), pricedParent), /unit_business/);
  });

  it("rejects a Custom feature that is already included free", () =>
    rejects(() => validateSelection(sel({ packageCode: "custom", featureKeys: ["dashboard"] }), published), /dashboard/));

  it("rejects duplicate feature keys", () =>
    rejects(() => validateSelection(sel({ packageCode: "custom", featureKeys: ["unit_pasar", "unit_pasar"] }), published), /unit_pasar/));

  it("rejects feature picking on a fixed package", () =>
    rejects(() => validateSelection(sel({ packageCode: "small", featureKeys: ["unit_pasar"] }), published), /featureKeys/));

  it("rejects an unknown support plan", () => rejects(() => validateSelection(sel({ packageCode: "small", supportPlanCode: "SP9" }), published), /SP9/));

  it("rejects bad add-on quantities and duplicates", () => {
    rejects(() => validateSelection(sel({ packageCode: "small", addons: [{ itemKey: "MEMBERS", qty: 0 }] }), published), /qty/);
    rejects(() => validateSelection(sel({ packageCode: "small", addons: [{ itemKey: "MEMBERS", qty: 1.5 }] }), published), /qty/);
    rejects(
      () => validateSelection(sel({ packageCode: "small", addons: [{ itemKey: "MEMBERS", qty: 1 }, { itemKey: "MEMBERS", qty: 2 }] }), published),
      /MEMBERS/
    );
  });

  it("rejects add-ons on fixed packages when the owner has switched that off", () => {
    const off = clone();
    off.snapshot.settings.addonsOnFixedPackages = false;
    rejects(() => validateSelection(sel({ packageCode: "small", addons: [{ itemKey: "USERS", qty: 1 }] }), off), /add-on/i);
    expect(() => validateSelection(sel({ packageCode: "custom", addons: [{ itemKey: "USERS", qty: 1 }] }), off)).not.toThrow();
  });
});

describe("subscription snapshot and resolveEntitlements", () => {
  it("captures the effective features and limits at subscription time", () => {
    const snap = buildSubscriptionSnapshot(sel({ packageCode: "small", addons: [{ itemKey: "MEMBERS", qty: 100 }] }), published);
    expect(snap.packageCode).toBe("small");
    expect(snap.pricingVersion).toBe(1);
    expect(snap.limits.members).toBe(600);
    expect(snap.features).toContain("period_closing");
    expect(snap.features).not.toContain("manual_journal");
  });

  it("resolves entitlements from the snapshot, not from the live catalog", () => {
    const snap = buildSubscriptionSnapshot(sel({ packageCode: "small" }), published);
    const ent = resolveEntitlements({ snapshot: snap, limitOverrides: null });
    expect(ent.hasFeature("period_closing")).toBe(true);
    expect(ent.hasFeature("manual_journal")).toBe(false);
    expect(ent.limits).toEqual({ members: 500, users: 10, savingTypes: 10, loanTypes: 10 });
  });

  it("applies per-tenant limit overrides on top of the snapshot", () => {
    const snap = buildSubscriptionSnapshot(sel({ packageCode: "free" }), published);
    const ent = resolveEntitlements({ snapshot: snap, limitOverrides: { members: 53 } });
    expect(ent.limits).toEqual({ members: 53, users: 1, savingTypes: 2, loanTypes: 2 });
  });
});
