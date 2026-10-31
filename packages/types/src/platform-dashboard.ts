export type DashboardRange = "30d" | "90d" | "12m";
export const DASHBOARD_RANGES = ["30d", "90d", "12m"] as const satisfies readonly DashboardRange[];

/** Kemendagri province codes. `Tenant.province` stores the code. */
export const PROVINCES = [
  { code: "11", name: "Aceh" },
  { code: "12", name: "Sumatera Utara" },
  { code: "13", name: "Sumatera Barat" },
  { code: "14", name: "Riau" },
  { code: "15", name: "Jambi" },
  { code: "16", name: "Sumatera Selatan" },
  { code: "17", name: "Bengkulu" },
  { code: "18", name: "Lampung" },
  { code: "19", name: "Kepulauan Bangka Belitung" },
  { code: "21", name: "Kepulauan Riau" },
  { code: "31", name: "DKI Jakarta" },
  { code: "32", name: "Jawa Barat" },
  { code: "33", name: "Jawa Tengah" },
  { code: "34", name: "DI Yogyakarta" },
  { code: "35", name: "Jawa Timur" },
  { code: "36", name: "Banten" },
  { code: "51", name: "Bali" },
  { code: "52", name: "Nusa Tenggara Barat" },
  { code: "53", name: "Nusa Tenggara Timur" },
  { code: "61", name: "Kalimantan Barat" },
  { code: "62", name: "Kalimantan Tengah" },
  { code: "63", name: "Kalimantan Selatan" },
  { code: "64", name: "Kalimantan Timur" },
  { code: "65", name: "Kalimantan Utara" },
  { code: "71", name: "Sulawesi Utara" },
  { code: "72", name: "Sulawesi Tengah" },
  { code: "73", name: "Sulawesi Selatan" },
  { code: "74", name: "Sulawesi Tenggara" },
  { code: "75", name: "Gorontalo" },
  { code: "76", name: "Sulawesi Barat" },
  { code: "81", name: "Maluku" },
  { code: "82", name: "Maluku Utara" },
  { code: "91", name: "Papua" },
  { code: "92", name: "Papua Barat" },
  { code: "93", name: "Papua Selatan" },
  { code: "94", name: "Papua Tengah" },
  { code: "95", name: "Papua Pegunungan" },
  { code: "96", name: "Papua Barat Daya" }
] as const satisfies readonly { code: string; name: string }[];

export const UNSET_REGION_LABEL = "Belum diisi";

export function provinceName(code: string | null | undefined): string {
  if (!code) return UNSET_REGION_LABEL;
  return PROVINCES.find((p) => p.code === code)?.name ?? code;
}

export interface PlatformGrowthPoint {
  /** `YYYY-MM-DD` for 30d/90d, `YYYY-MM` for 12m. */
  bucket: string;
  tenants: number;
  users: number;
}

export interface MemberPoint {
  bucket: string;
  newMembers: number;
  totalMembers: number;
}

export interface ActivityPoint {
  bucket: string;
  /** `AuditLog` rows written in the bucket. */
  actions: number;
}

export interface TechnicalPoint {
  bucket: string;
  requests: number;
  /** 0..1 */
  errorRate: number;
  /** Null when the bucket has no requests. Daily/monthly values are count-weighted averages of hourly values (approximate). */
  p50Ms: number | null;
  p95Ms: number | null;
}

export interface RegionRow {
  /** Province code, or null for tenants without a region. */
  code: string | null;
  name: string;
  tenants: number;
  users: number;
  members: number;
}

export type AttentionSeverity = "critical" | "warning" | "info";

export interface AttentionItem {
  id: string;
  severity: AttentionSeverity;
  kind:
    | "INVOICE_OVERDUE"
    | "SUBSCRIPTION_PAST_DUE"
    | "BILLING_DUE_SOON"
    | "TENANT_INACTIVE"
    | "ERROR_RATE"
    | "TENANT_NO_REGION";
  message: string;
  /** In-app route to act on it. */
  href?: string;
}

export interface RevenuePoint {
  /** `YYYY-MM` */
  month: string;
  /** Decimal string, 2 places. */
  amount: string;
}

export interface RevenueSummary {
  /** Always the last 12 months, whatever the range filter. */
  series: RevenuePoint[];
  thisMonth: string;
  previousMonth: string;
  /** Percent change thisMonth vs previousMonth, 1 decimal; null when previousMonth is 0. */
  deltaPct: number | null;
  /** Monthly recurring revenue from ACTIVE subscriptions (YEARLY ÷ 12). Decimal string. */
  mrr: string;
}

export interface PlatformDashboard {
  range: DashboardRange;
  generatedAt: string;
  kpis: { tenants: number; users: number; members: number; mrr: string };
  performance: {
    activeTenants7d: number;
    activeTenants30d: number;
    activity: ActivityPoint[];
    technical: TechnicalPoint[];
  };
  growth: PlatformGrowthPoint[];
  members: { series: MemberPoint[]; total: number };
  regions: RegionRow[];
  attention: AttentionItem[];
  revenue: RevenueSummary;
}
