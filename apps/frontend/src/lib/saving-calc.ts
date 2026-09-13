// Client-side mirror of the backend's saving interest math (apps/backend/src/lib/saving-calc.ts),
// used only for an instant on-screen simulation in the config form — the backend is
// authoritative for anything actually posted.
import type { SavingPeriodUnit } from "@siskop/types";

export function calculateSavingInterest(
  balance: number,
  annualRatePct: number,
  periodUnit: SavingPeriodUnit
): number {
  const divisor = periodUnit === "DAILY" ? 360 : periodUnit === "MONTHLY" ? 12 : 1;
  return round2((balance * (annualRatePct / 100)) / divisor);
}

/** Daily-equivalent interest for an annual rate, regardless of the config's own periodUnit. */
export function calculateDailySavingInterest(balance: number, annualRatePct: number): number {
  return calculateSavingInterest(balance, annualRatePct, "DAILY");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const SAVING_PERIOD_LABELS: Record<SavingPeriodUnit, string> = {
  DAILY: "Harian",
  MONTHLY: "Bulanan",
  YEARLY: "Tahunan"
};
