import type { PricingSeed } from "./seed.js";
import type { CatalogSnapshot } from "./snapshot.js";

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * A catalog snapshot in the seed file shape. Export, import and rollback all
 * go through this one shape, so they cannot drift from the seed.
 */
export function snapshotToSeed(c: CatalogSnapshot, version: number): PricingSeed {
  const fixed = c.packages.filter((p) => !p.isCustom);
  return {
    version,
    settings: {
      yearlyMultiplier: c.settings.yearlyMultiplier,
      enabledCycles: c.settings.enabledCycles as PricingSeed["settings"]["enabledCycles"],
      defaultPackageCode: c.settings.defaultPackageCode,
      customEnabled: c.settings.customEnabled,
      customBaseLimits: c.settings.customBaseLimits as PricingSeed["settings"]["customBaseLimits"],
      addonsOnFixedPackages: c.settings.addonsOnFixedPackages,
      paymentGraceDays: c.settings.paymentGraceDays,
      unpaidRegistrationPurgeDays: c.settings.unpaidRegistrationPurgeDays,
      taxRate: num(c.settings.taxRate),
      invoiceNumberFormat: c.settings.invoiceNumberFormat,
      paymentProvider: c.settings.paymentProvider,
      paymentInstructions: c.settings.paymentInstructions,
      oneFreeTenantPerRegistrationNo: c.settings.oneFreeTenantPerRegistrationNo
    },
    packages: c.packages.map((p) => ({
      code: p.code,
      name: p.name,
      isCustom: p.isCustom,
      isPublic: p.isPublic,
      sortOrder: p.sortOrder,
      priceMonthly: num(p.priceMonthly),
      priceYearly: num(p.priceYearly),
      limits: p.isCustom ? "dynamic: settings.customBaseLimits + volume add-ons" : p.limits
    })),
    features: c.features.map((f) => ({
      key: f.key,
      name: f.name,
      parentKey: f.parentKey,
      requires: f.requires,
      customPrice: Number(f.customPrice),
      ...(f.priceGroup ? { priceGroup: f.priceGroup } : {}),
      isActive: f.isActive,
      includedIn: fixed.filter((p) => p.features.includes(f.key)).map((p) => p.code)
    })),
    volumeAddons: c.volumeAddons.map((a) => ({
      itemKey: a.itemKey as PricingSeed["volumeAddons"][number]["itemKey"],
      stepQty: a.stepQty,
      price: Number(a.price),
      period: a.period as "MONTHLY" | "YEARLY"
    })),
    supportPlans: c.supportPlans.map((s) => ({ ...s, yearlyCost: Number(s.yearlyCost) }))
  };
}
