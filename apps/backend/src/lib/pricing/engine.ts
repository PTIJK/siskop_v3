import { Prisma } from "@prisma/client";
import type { BillingCycle, PricingLimits, PricingQuote, PricingSelection, QuoteLine, VolumeItem } from "@siskop/types";
import { validationError } from "../errors.js";
import type { CatalogSnapshot } from "./snapshot.js";

/**
 * The only place a price is computed or a limit is derived. Pure: no database,
 * no clock. Callers pass a published catalog (a PricingVersion snapshot), so a
 * live draft edit by the owner can never leak into a quote.
 */

export interface PublishedCatalog {
  version: number;
  snapshot: CatalogSnapshot;
}

/** Stored on TenantSubscription.snapshot: effective access frozen at subscription time. */
export interface SubscriptionSnapshot {
  pricingVersion: number;
  packageCode: string;
  packageName: string;
  features: string[];
  limits: PricingLimits;
}

type Dim = keyof PricingLimits;
const DIM_OF: Record<VolumeItem, Dim> = { MEMBERS: "members", USERS: "users", SAVING_TYPES: "savingTypes", LOAN_TYPES: "loanTypes" };
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const round2 = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const fmt = (d: Prisma.Decimal) => round2(d).toFixed(2);

interface Normalized {
  pkg: CatalogSnapshot["packages"][number];
  cycle: BillingCycle;
  supportPlan: CatalogSnapshot["supportPlans"][number] | null;
  featureKeys: string[];
  addons: { itemKey: VolumeItem; qty: number }[];
}

function freeFeatureKeys(c: CatalogSnapshot): Set<string> {
  return new Set(c.features.filter((f) => f.isActive && D(f.customPrice).isZero()).map((f) => f.key));
}

/** Rejects anything the engine cannot price. Never trusts a client-supplied amount: there is no such field. */
export function validateSelection(selection: PricingSelection, published: PublishedCatalog, opts: { publicOnly?: boolean } = {}): Normalized {
  const c = published.snapshot;
  const pkg = c.packages.find((p) => p.code === selection.packageCode);
  if (!pkg) throw validationError(`Unknown package "${selection.packageCode}"`);
  if (opts.publicOnly && !pkg.isPublic) throw validationError(`Package "${pkg.code}" is not available`);
  if (pkg.isCustom && !c.settings.customEnabled) throw validationError("Custom package is not available");
  if (!c.settings.enabledCycles.includes(selection.billingCycle)) {
    throw validationError(`Billing cycle "${selection.billingCycle}" is not enabled`);
  }

  const supportPlan = selection.supportPlanCode ? (c.supportPlans.find((s) => s.code === selection.supportPlanCode) ?? null) : null;
  if (selection.supportPlanCode && !supportPlan) throw validationError(`Unknown support plan "${selection.supportPlanCode}"`);

  const featureKeys = selection.featureKeys ?? [];
  if (pkg.isCustom) {
    const free = freeFeatureKeys(c);
    const byKey = new Map(c.features.filter((f) => f.isActive).map((f) => [f.key, f]));
    const chosen = new Set<string>();
    for (const key of featureKeys) {
      if (chosen.has(key)) throw validationError(`Duplicate feature "${key}"`);
      chosen.add(key);
    }
    for (const key of chosen) {
      const f = byKey.get(key);
      if (!f) throw validationError(`Unknown feature "${key}"`);
      if (free.has(key)) throw validationError(`Feature "${key}" is already included free in Custom`);
      if (f.parentKey && !free.has(f.parentKey) && !chosen.has(f.parentKey)) {
        throw validationError(`Feature "${key}" needs its parent "${f.parentKey}"`);
      }
      for (const req of f.requires) {
        if (!free.has(req) && !chosen.has(req)) throw validationError(`Feature "${key}" requires "${req}"`);
      }
    }
  } else if (featureKeys.length > 0) {
    throw validationError("featureKeys is only allowed on the custom package");
  }

  const addons = selection.addons ?? [];
  if (addons.length > 0 && !pkg.isCustom && !c.settings.addonsOnFixedPackages) {
    throw validationError("Add-ons are not available on fixed packages");
  }
  const seen = new Set<string>();
  for (const a of addons) {
    if (!c.volumeAddons.some((v) => v.itemKey === a.itemKey)) throw validationError(`Unknown add-on "${a.itemKey}"`);
    if (seen.has(a.itemKey)) throw validationError(`Duplicate add-on "${a.itemKey}"`);
    seen.add(a.itemKey);
    if (!Number.isInteger(a.qty) || a.qty < 1) throw validationError(`Add-on ${a.itemKey} qty must be a positive integer`);
  }

  return { pkg, cycle: selection.billingCycle, supportPlan, featureKeys, addons: [...addons] };
}

function effectiveLimits(n: Normalized, c: CatalogSnapshot): PricingLimits {
  const base: PricingLimits = n.pkg.isCustom ? (c.settings.customBaseLimits as PricingLimits) : n.pkg.limits;
  const out: PricingLimits = { ...base };
  for (const a of n.addons) {
    const dim = DIM_OF[a.itemKey];
    const current = out[dim];
    out[dim] = current === null ? null : current + a.qty;
  }
  return out;
}

function effectiveFeatures(n: Normalized, c: CatalogSnapshot): string[] {
  if (!n.pkg.isCustom) return [...n.pkg.features];
  const chosen = new Set(n.featureKeys);
  const free = freeFeatureKeys(c);
  return c.features.filter((f) => free.has(f.key) || chosen.has(f.key)).map((f) => f.key);
}

/** Validates, then prices one selection for one billing cycle. */
export function quote(selection: PricingSelection, published: PublishedCatalog, opts: { publicOnly?: boolean } = {}): PricingQuote {
  const n = validateSelection(selection, published, opts);
  const c = published.snapshot;
  const yearly = n.cycle === "YEARLY";
  const lines: QuoteLine[] = [];
  let recurring = D(0);

  if (n.pkg.isCustom) {
    const mult = yearly ? D(c.settings.yearlyMultiplier) : D(1);
    const chosen = new Set(n.featureKeys);
    const groupPrice = new Map<string, Prisma.Decimal>();
    for (const f of c.features) {
      if (f.priceGroup && chosen.has(f.key)) {
        groupPrice.set(f.priceGroup, Prisma.Decimal.max(groupPrice.get(f.priceGroup) ?? D(0), D(f.customPrice)));
      }
    }
    const groupCharged = new Set<string>();
    for (const f of c.features) {
      if (!chosen.has(f.key)) continue;
      let amount = D(f.customPrice).times(mult);
      if (f.priceGroup) {
        // A price group is charged once, at its highest member price.
        amount = groupCharged.has(f.priceGroup) ? D(0) : (groupPrice.get(f.priceGroup) as Prisma.Decimal).times(mult);
        groupCharged.add(f.priceGroup);
      }
      recurring = recurring.plus(amount);
      lines.push({ kind: "FEATURE", key: f.key, label: f.name, amount: fmt(amount) });
    }
  } else {
    const price = yearly ? n.pkg.priceYearly : n.pkg.priceMonthly;
    const amount = D(price ?? 0);
    recurring = recurring.plus(amount);
    lines.push({ kind: "PACKAGE", key: n.pkg.code, label: n.pkg.name, amount: fmt(amount) });
  }

  for (const a of n.addons) {
    const def = c.volumeAddons.find((v) => v.itemKey === a.itemKey) as CatalogSnapshot["volumeAddons"][number];
    const steps = Math.ceil(a.qty / def.stepQty);
    const stepPrice = D(def.price);
    // Prices are stated per period; a yearly price billed monthly is one twelfth.
    const perCycle = yearly
      ? def.period === "YEARLY" ? stepPrice : stepPrice.times(12)
      : def.period === "YEARLY" ? stepPrice.dividedBy(12) : stepPrice;
    const amount = round2(perCycle.times(steps));
    recurring = recurring.plus(amount);
    lines.push({ kind: "ADDON", key: a.itemKey, label: `${a.itemKey} +${a.qty}`, qty: a.qty, amount: fmt(amount) });
  }

  const support = D(n.supportPlan?.yearlyCost ?? 0);
  if (n.supportPlan) lines.push({ kind: "SUPPORT", key: n.supportPlan.code, label: n.supportPlan.name, amount: fmt(support) });

  const subtotal = recurring.plus(support);
  const taxRate = c.settings.taxRate;
  const tax = taxRate === null ? D(0) : round2(subtotal.times(D(taxRate)));

  return {
    pricingVersion: published.version,
    packageCode: n.pkg.code,
    billingCycle: n.cycle,
    lines,
    amountPerCycle: fmt(recurring),
    supportYearly: fmt(support),
    subtotal: fmt(subtotal),
    taxRate,
    taxAmount: fmt(tax),
    total: fmt(subtotal.plus(tax)),
    effectiveFeatures: effectiveFeatures(n, c),
    effectiveLimits: effectiveLimits(n, c)
  };
}

/** What gets frozen onto TenantSubscription.snapshot when a tenant subscribes. */
export function buildSubscriptionSnapshot(
  selection: PricingSelection,
  published: PublishedCatalog,
  opts: { publicOnly?: boolean } = {}
): SubscriptionSnapshot {
  const n = validateSelection(selection, published, opts);
  return {
    pricingVersion: published.version,
    packageCode: n.pkg.code,
    packageName: n.pkg.name,
    features: effectiveFeatures(n, published.snapshot),
    limits: effectiveLimits(n, published.snapshot)
  };
}

export interface Entitlements {
  packageCode: string;
  features: string[];
  limits: PricingLimits;
  hasFeature(key: string): boolean;
}

/** Effective access: the frozen snapshot, then per-tenant limit overrides. An override of null means unlimited. */
export function resolveEntitlements(sub: { snapshot: SubscriptionSnapshot; limitOverrides: Partial<PricingLimits> | null }): Entitlements {
  const limits: PricingLimits = { ...sub.snapshot.limits };
  for (const dim of Object.keys(limits) as Dim[]) {
    const override = sub.limitOverrides?.[dim];
    if (override !== undefined) limits[dim] = override;
  }
  const features = new Set(sub.snapshot.features);
  return { packageCode: sub.snapshot.packageCode, features: [...features], limits, hasFeature: (key) => features.has(key) };
}
