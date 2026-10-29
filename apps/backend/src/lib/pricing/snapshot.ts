import type { Prisma } from "@prisma/client";
import type { TxClient } from "../db.js";

type Money = Prisma.Decimal | null;
const money = (d: Money): string | null => (d === null ? null : d.toString());

export interface CatalogSnapshot {
  packages: {
    code: string;
    name: string;
    isCustom: boolean;
    isPublic: boolean;
    sortOrder: number;
    priceMonthly: string | null;
    priceYearly: string | null;
    limits: { members: number | null; users: number | null; savingTypes: number | null; loanTypes: number | null };
    features: string[];
  }[];
  features: {
    key: string;
    name: string;
    parentKey: string | null;
    requires: string[];
    customPrice: string;
    priceGroup: string | null;
    sortOrder: number;
    isActive: boolean;
  }[];
  volumeAddons: { itemKey: string; stepQty: number; price: string; period: string }[];
  supportPlans: {
    code: string;
    name: string;
    yearlyCost: string;
    remote: boolean;
    onsite: boolean;
    visitsPerYear: number;
    slaHours: number | null;
    aiSupport: boolean;
  }[];
  settings: {
    yearlyMultiplier: number;
    enabledCycles: string[];
    defaultPackageCode: string;
    customEnabled: boolean;
    customBaseLimits: unknown;
    addonsOnFixedPackages: boolean;
    paymentGraceDays: number;
    unpaidRegistrationPurgeDays: number;
    taxRate: string | null;
    invoiceNumberFormat: string;
    paymentProvider: string;
    paymentInstructions: string | null;
    oneFreeTenantPerRegistrationNo: boolean;
  };
}

const ADDON_ORDER = ["MEMBERS", "USERS", "SAVING_TYPES", "LOAN_TYPES"];

/** Reads the live catalog tables into the immutable shape PricingVersion stores. Money is a string. */
export async function buildCatalogSnapshot(tx: TxClient): Promise<CatalogSnapshot> {
  const [packages, features, addons, plans, settings] = await Promise.all([
    tx.subscriptionPackage.findMany({
      where: { code: { not: null } },
      orderBy: { sortOrder: "asc" },
      include: { features: { where: { included: true }, include: { feature: true } } }
    }),
    tx.feature.findMany({ orderBy: { sortOrder: "asc" }, include: { parent: true } }),
    tx.volumeAddon.findMany(),
    tx.supportPlan.findMany({ orderBy: { code: "asc" } }),
    tx.pricingSetting.findUniqueOrThrow({ where: { id: "singleton" } })
  ]);

  return {
    packages: packages.map((p) => ({
      code: p.code as string,
      name: p.name,
      isCustom: p.isCustom,
      isPublic: p.isPublic,
      sortOrder: p.sortOrder,
      priceMonthly: money(p.priceMonthly),
      priceYearly: money(p.priceYearly),
      limits: { members: p.maxMembers, users: p.maxUsers, savingTypes: p.maxSavingTypes, loanTypes: p.maxLoanTypes },
      features: [...p.features].sort((a, b) => a.feature.sortOrder - b.feature.sortOrder).map((pf) => pf.feature.key)
    })),
    features: features.map((f) => ({
      key: f.key,
      name: f.name,
      parentKey: f.parent?.key ?? null,
      requires: f.requires,
      customPrice: f.customPrice.toString(),
      priceGroup: f.priceGroup,
      sortOrder: f.sortOrder,
      isActive: f.isActive
    })),
    volumeAddons: [...addons]
      .sort((a, b) => ADDON_ORDER.indexOf(a.itemKey) - ADDON_ORDER.indexOf(b.itemKey))
      .map((a) => ({ itemKey: a.itemKey, stepQty: a.stepQty, price: a.price.toString(), period: a.period })),
    supportPlans: plans.map((s) => ({
      code: s.code,
      name: s.name,
      yearlyCost: s.yearlyCost.toString(),
      remote: s.remote,
      onsite: s.onsite,
      visitsPerYear: s.visitsPerYear,
      slaHours: s.slaHours,
      aiSupport: s.aiSupport
    })),
    settings: {
      yearlyMultiplier: settings.yearlyMultiplier,
      enabledCycles: settings.enabledCycles,
      defaultPackageCode: settings.defaultPackageCode,
      customEnabled: settings.customEnabled,
      customBaseLimits: settings.customBaseLimits,
      addonsOnFixedPackages: settings.addonsOnFixedPackages,
      paymentGraceDays: settings.paymentGraceDays,
      unpaidRegistrationPurgeDays: settings.unpaidRegistrationPurgeDays,
      taxRate: settings.taxRate === null ? null : settings.taxRate.toFixed(4),
      invoiceNumberFormat: settings.invoiceNumberFormat,
      paymentProvider: settings.paymentProvider,
      paymentInstructions: settings.paymentInstructions,
      oneFreeTenantPerRegistrationNo: settings.oneFreeTenantPerRegistrationNo
    }
  };
}
