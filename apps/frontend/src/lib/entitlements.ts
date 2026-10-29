import type { PricingLimits, PublicPricingCatalog, TenantSubscriptionInfo } from "@siskop/types";

/**
 * Whether the app should lock a feature. Only when the server says it enforces
 * (`enforcement === "on"`): in off or shadow mode a lock would hide something
 * the server still serves. Nothing is locked until the subscription has loaded.
 */
export function isFeatureLocked(info: TenantSubscriptionInfo | null | undefined, key: string): boolean {
  if (!info || info.enforcement !== "on") return false;
  return !info.features.includes(key);
}

export type MeterState = "unlimited" | "ok" | "near" | "full" | "over";

export interface UsageMeter {
  used: number;
  limit: number | null;
  /** 0..1 for a progress bar, capped at 1. */
  ratio: number;
  state: MeterState;
}

const NEAR_RATIO = 0.8;

export function usageMeter(used: number, limit: number | null): UsageMeter {
  if (limit === null) return { used, limit, ratio: 0, state: "unlimited" };
  const ratio = limit === 0 ? 1 : Math.min(1, used / limit);
  const state: MeterState = used > limit ? "over" : used >= limit ? "full" : used >= limit * NEAR_RATIO ? "near" : "ok";
  return { used, limit, ratio, state };
}

export interface QuotaHint {
  /** "10/50", shown beside a create button. */
  label: string;
  /** The server will refuse the next create. */
  blocked: boolean;
  meter: UsageMeter;
}

/** What to show beside a create button for one volume item; null when it is unlimited or not loaded yet. */
export function quotaHint(info: TenantSubscriptionInfo | null | undefined, item: keyof PricingLimits): QuotaHint | null {
  if (!info) return null;
  const meter = usageMeter(info.usage[item], info.limits[item]);
  if (meter.limit === null) return null;
  return { label: `${meter.used}/${meter.limit}`, blocked: info.enforcement === "on" && meter.used >= meter.limit, meter };
}

/** Names of the fixed packages that include a feature, cheapest first: "which package unlocks this". */
export function unlockingPackages(catalog: PublicPricingCatalog, key: string): string[] {
  return catalog.packages
    .filter((p) => !p.isCustom && p.features.includes(key))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((p) => p.name);
}

export interface AccessNotice {
  tone: "error";
  message: string;
}

/** The banner shown when the server is refusing the koperasi because of its payment standing. */
export function accessNotice(info: TenantSubscriptionInfo | null | undefined): AccessNotice | null {
  if (!info || info.enforcement !== "on") return null;
  switch (info.status) {
    case "PAST_DUE":
      return { tone: "error", message: "Pembayaran langganan terlambat. Data hanya dapat dilihat sampai faktur dilunasi." };
    case "PENDING_PAYMENT":
      return { tone: "error", message: "Langganan belum aktif. Selesaikan pembayaran faktur pendaftaran." };
    case "CANCELLED":
      return { tone: "error", message: "Langganan telah dihentikan." };
    default:
      return null;
  }
}
