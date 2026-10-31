import type { AttentionSeverity, DashboardRange, RegionRow, TechnicalPoint } from "@siskop/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export const RANGE_LABEL: Record<DashboardRange, string> = { "30d": "30 hari", "90d": "90 hari", "12m": "12 bulan" };

export const SEVERITY_LABEL: Record<AttentionSeverity, string> = { critical: "Kritis", warning: "Perlu dicek", info: "Info" };

/** `2026-10-05` -> `5 Okt`; `2026-08` -> `Agu 2026`. */
export function bucketLabel(bucket: string): string {
  const [year, month, day] = bucket.split("-");
  const name = MONTHS[Number(month) - 1] ?? month ?? "";
  return day ? `${Number(day)} ${name}` : `${name} ${year}`;
}

export function deltaLabel(pct: number | null): string {
  if (pct === null) return "Belum ada pembanding";
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")}% dari bulan lalu`;
}

export const hasTechnicalData = (points: TechnicalPoint[]): boolean => points.some((p) => p.requests > 0);

/** First `limit` named regions (already sorted by the API), plus the "Belum diisi" row if present. */
export function topRegions(rows: RegionRow[], limit = 10): RegionRow[] {
  const named = rows.filter((r) => r.code !== null).slice(0, limit);
  const unset = rows.find((r) => r.code === null);
  return unset ? [...named, unset] : named;
}
