/** Pricing V2 wire shapes. Money is always a Decimal string; null limit = unlimited. */

export type BillingCycle = "MONTHLY" | "YEARLY";
export type VolumeItem = "MEMBERS" | "USERS" | "SAVING_TYPES" | "LOAN_TYPES";

export interface PricingLimits {
  members: number | null;
  users: number | null;
  savingTypes: number | null;
  loanTypes: number | null;
}

/** What a client may send to the quote endpoint. The server never accepts a price. */
export interface PricingSelection {
  packageCode: string;
  billingCycle: BillingCycle;
  supportPlanCode?: string;
  featureKeys?: string[];
  addons?: { itemKey: VolumeItem; qty: number }[];
}

export interface QuoteLine {
  kind: "PACKAGE" | "FEATURE" | "ADDON" | "SUPPORT";
  key: string;
  label: string;
  qty?: number;
  amount: string;
}

export interface PricingQuote {
  pricingVersion: number;
  packageCode: string;
  billingCycle: BillingCycle;
  lines: QuoteLine[];
  /** Recurring amount per billing cycle, excluding the yearly support fee. */
  amountPerCycle: string;
  /** Yearly support plan fee, billed once per year; "0.00" when none. */
  supportYearly: string;
  /** First invoice before VAT: amountPerCycle + supportYearly. */
  subtotal: string;
  /** Null until the owner sets the VAT rate; taxAmount is then "0.00". */
  taxRate: string | null;
  taxAmount: string;
  total: string;
  effectiveFeatures: string[];
  effectiveLimits: PricingLimits;
}

export interface PublicPricingCatalog {
  version: number;
  currency: "IDR";
  packages: {
    code: string;
    name: string;
    isCustom: boolean;
    sortOrder: number;
    priceMonthly: string | null;
    priceYearly: string | null;
    limits: PricingLimits;
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
  }[];
  volumeAddons: { itemKey: VolumeItem; stepQty: number; price: string; period: "MONTHLY" | "YEARLY" }[];
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
    enabledCycles: BillingCycle[];
    defaultPackageCode: string;
    customEnabled: boolean;
    customBaseLimits: PricingLimits;
    addonsOnFixedPackages: boolean;
    taxRate: string | null;
  };
}

/** GET /api/config/subscription: what the tenant app loads at login. */
export interface TenantSubscriptionInfo {
  packageCode: string;
  packageName: string;
  status: "PENDING_PAYMENT" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  billingCycle: BillingCycle;
  nextBillingDate: string | null;
  features: string[];
  limits: PricingLimits;
  usage: { members: number; users: number; savingTypes: number; loanTypes: number };
  /** Which Pricing V2 mode the server runs in; the app only locks things when this is "on". */
  enforcement: "off" | "shadow" | "on";
  /** The earliest unpaid invoice, or null when nothing is owed. */
  openInvoice: { number: string; type: "REGISTRATION" | "RENEWAL" | "ADDON" | "SUPPORT"; total: string; dueDate: string } | null;
  /** The owner's bank-transfer text, shown beside an open invoice. */
  paymentInstructions: string | null;
}

// ── Owner console (platform admin) ───────────────────────────────────────────

export interface PricingCatalogPackage {
  code: string;
  name: string;
  isCustom: boolean;
  isPublic: boolean;
  sortOrder: number;
  priceMonthly: string | null;
  priceYearly: string | null;
  limits: PricingLimits;
  features: string[];
}

export interface PricingCatalogFeature {
  key: string;
  name: string;
  parentKey: string | null;
  requires: string[];
  customPrice: string;
  priceGroup: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface PricingCatalogSettings {
  yearlyMultiplier: number;
  enabledCycles: BillingCycle[];
  defaultPackageCode: string;
  customEnabled: boolean;
  customBaseLimits: PricingLimits;
  addonsOnFixedPackages: boolean;
  paymentGraceDays: number;
  unpaidRegistrationPurgeDays: number;
  /** Fraction, 0.11 = 11%. Null until the owner enters it. */
  taxRate: string | null;
  invoiceNumberFormat: string;
  paymentProvider: string;
  paymentInstructions: string | null;
  oneFreeTenantPerRegistrationNo: boolean;
}

export interface PricingCatalog {
  packages: PricingCatalogPackage[];
  features: PricingCatalogFeature[];
  volumeAddons: { itemKey: VolumeItem; stepQty: number; price: string; period: "MONTHLY" | "YEARLY" }[];
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
  settings: PricingCatalogSettings;
}

export interface PricingDraft {
  publishedVersion: number | null;
  changeCount: number;
  catalog: PricingCatalog;
}

export interface PricingChange {
  section: "packages" | "features" | "volumeAddons" | "supportPlans" | "settings";
  key: string;
  type: "ADDED" | "REMOVED" | "CHANGED";
  fields?: { field: string; before: unknown; after: unknown }[];
}

export interface PricingDiff {
  fromVersion: number | null;
  changes: PricingChange[];
}

export interface PricingVersionSummary {
  version: number;
  publishedBy: string | null;
  publishedAt: string;
}

export interface PricingAuditEntry {
  id: string;
  actorId: string | null;
  entity: string;
  entityId: string | null;
  action: string;
  before: unknown;
  after: unknown;
  at: string;
}

/** A tenant's subscription as the platform admin sees it. */
export interface AdminTenantSubscription {
  packageCode: string;
  packageName: string;
  status: "PENDING_PAYMENT" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  billingCycle: BillingCycle;
  amountPerCycle: string;
  pricingVersion: number;
  nextBillingDate: string | null;
  supportPlanCode: string | null;
  selectedFeatureKeys: string[];
  addons: Partial<Record<VolumeItem, number>>;
  limitOverrides: Partial<PricingLimits> | null;
  createdVia: "REGISTRATION" | "ADMIN" | "MIGRATION";
}

export interface AdminTenantSubscriptionDetail {
  subscription: AdminTenantSubscription | null;
  features: string[];
  limits: PricingLimits | null;
  usage: { members: number; users: number; savingTypes: number; loanTypes: number };
}
