import type { CompareMode } from "@siskop/types";

export const COMPARE_NONE = "none";

export const COMPARE_OPTIONS: { value: CompareMode | typeof COMPARE_NONE; label: string }[] = [
  { value: COMPARE_NONE, label: "Tanpa pembanding" },
  { value: "PREVIOUS_PERIOD", label: "Periode sebelumnya" },
  { value: "PREVIOUS_YEAR", label: "Tahun lalu" }
];

/** `&compare=...` for a report URL; empty when comparison is off. */
export function compareQueryParam(compare: string): string {
  return compare === "PREVIOUS_PERIOD" || compare === "PREVIOUS_YEAR" ? `&compare=${compare}` : "";
}

/**
 * Change from the earlier figure to the current one, and as a share of the earlier
 * figure's size. Rounded to the sen so decimal strings never show float noise; the
 * share is null when there is no earlier amount to take a share of.
 */
export function rowDelta(current: string, previous: string | undefined): { amount: number; pct: number | null } {
  const cur = Math.round(Number(current) * 100);
  const prev = Math.round(Number(previous ?? 0) * 100);
  const amount = (cur - prev) / 100;
  if (prev === 0) return { amount, pct: null };
  return { amount, pct: ((cur - prev) / Math.abs(prev)) * 100 };
}

export function formatDeltaPct(pct: number | null): string {
  if (pct === null) return "-";
  if (pct === 0) return "0%";
  const text = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format(Math.abs(pct));
  return `${pct > 0 ? "+" : "-"}${text}%`;
}
