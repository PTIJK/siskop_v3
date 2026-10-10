import type { SourceRef } from "@siskop/types";
import { ALL_UNITS } from "@/lib/unit";

/** The page of the loan or saving a ledger line came from, or null when the source has none. */
export function sourceHref(ref: SourceRef | null): string | null {
  if (!ref) return null;
  return ref.kind === "LOAN" ? `/loans/${ref.id}` : `/savings/${ref.id}`;
}

export interface DrilldownTarget {
  accountId: string;
  from: string;
  to: string;
  unitId: string;
}

/** Link from a statement or trial-balance row to that account's Buku Besar, for the same period and unit. */
export function bukuBesarHref(accountId: string, period: { from: string; to: string; unitId: string }): string {
  const q = new URLSearchParams({ tab: "buku-besar", account: accountId, from: period.from, to: period.to });
  if (period.unitId !== ALL_UNITS) q.set("unitId", period.unitId);
  return `/reports/accounting?${q.toString()}`;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Reads a drill-down link back; null when it is incomplete or malformed, so a bad link just opens the overview. */
export function parseDrilldown(params: URLSearchParams): DrilldownTarget | null {
  const accountId = params.get("account");
  const from = params.get("from");
  const to = params.get("to");
  if (!accountId || !from || !to || !DATE.test(from) || !DATE.test(to)) return null;
  return { accountId, from, to, unitId: params.get("unitId") ?? ALL_UNITS };
}
