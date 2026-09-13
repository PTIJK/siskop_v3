import type { SavingPeriodUnit } from "@siskop/types";

/**
 * Bunga simpanan per periode: a SavingConfig's `rate` is always a percent per
 * year (same assumption validateRegulatoryRate makes) — periodUnit only says
 * how often that annual rate gets calculated & credited, not a rescaling of
 * the number itself. Uses the same /360-day, 12x30-day convention as the
 * loan HARIAN rate type (see apps/backend/src/lib/loan-calc.ts).
 */
export function calculateSavingInterest(
  balance: number,
  annualRatePct: number,
  periodUnit: SavingPeriodUnit
): number {
  const divisor = periodUnit === "DAILY" ? 360 : periodUnit === "MONTHLY" ? 12 : 1;
  return round2((balance * (annualRatePct / 100)) / divisor);
}

/** Daily-equivalent interest for an annual rate, regardless of the config's own periodUnit — lets a Bulanan/Tahunan config's daily amount be checked too. */
export function calculateDailySavingInterest(balance: number, annualRatePct: number): number {
  return calculateSavingInterest(balance, annualRatePct, "DAILY");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
