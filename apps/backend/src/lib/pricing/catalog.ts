import type { PublicPricingCatalog, VolumeItem } from "@siskop/types";
import { db } from "../db.js";
import { notFound } from "../errors.js";
import type { PublishedCatalog } from "./engine.js";
import type { CatalogSnapshot } from "./snapshot.js";

const TTL_MS = 60_000;
let cached: { at: number; value: PublishedCatalog } | null = null;

/**
 * The newest published PricingVersion, cached for 60 seconds. Quotes, the
 * registration page and new subscriptions read this and never the live draft
 * tables, so an owner's unpublished edit cannot change a price.
 */
export async function getPublishedCatalog(now: number = Date.now()): Promise<PublishedCatalog> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  const row = await db.pricingVersion.findFirst({ orderBy: { version: "desc" } });
  if (!row) throw notFound("Katalog harga belum dipublikasikan");
  const value = { version: row.version, snapshot: row.snapshot as unknown as CatalogSnapshot };
  cached = { at: now, value };
  return value;
}

export function clearCatalogCache(): void {
  cached = null;
}

/** The catalog as the registration page sees it: public packages only, no payment or operational settings. */
export function toPublicCatalog({ version, snapshot: c }: PublishedCatalog): PublicPricingCatalog {
  return {
    version,
    currency: "IDR",
    packages: c.packages
      .filter((p) => p.isPublic)
      .map((p) => ({
        code: p.code,
        name: p.name,
        isCustom: p.isCustom,
        sortOrder: p.sortOrder,
        priceMonthly: p.priceMonthly,
        priceYearly: p.priceYearly,
        limits: p.limits,
        features: p.features
      })),
    features: c.features
      .filter((f) => f.isActive)
      .map((f) => ({
        key: f.key,
        name: f.name,
        parentKey: f.parentKey,
        requires: f.requires,
        customPrice: f.customPrice,
        priceGroup: f.priceGroup,
        sortOrder: f.sortOrder
      })),
    volumeAddons: c.volumeAddons.map((a) => ({
      itemKey: a.itemKey as VolumeItem,
      stepQty: a.stepQty,
      price: a.price,
      period: a.period as "MONTHLY" | "YEARLY"
    })),
    supportPlans: c.supportPlans,
    settings: {
      yearlyMultiplier: c.settings.yearlyMultiplier,
      enabledCycles: c.settings.enabledCycles as ("MONTHLY" | "YEARLY")[],
      defaultPackageCode: c.settings.defaultPackageCode,
      customEnabled: c.settings.customEnabled,
      customBaseLimits: c.settings.customBaseLimits as PublicPricingCatalog["settings"]["customBaseLimits"],
      addonsOnFixedPackages: c.settings.addonsOnFixedPackages,
      taxRate: c.settings.taxRate
    }
  };
}
