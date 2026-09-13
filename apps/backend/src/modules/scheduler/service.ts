import { recalculateAllKOL } from "../../lib/kol.js";
import { runDailySavingInterestAccrual, type SavingInterestAccrualResult } from "../savings/service.js";

export interface DailySchedulerResult {
  date: string;
  savingsInterest: SavingInterestAccrualResult;
  loanKol: { checked: number; failed: number };
}

/**
 * The one daily "system date tick" for every date-driven calculation that
 * isn't triggered by a user action: savings interest accrual and loan
 * KOL/overdue reclassification today, with room for more jobs later. Each
 * job is isolated so one failing doesn't block the other — a thrown error
 * here is reported as `failed` on that job's result, never surfaced as an
 * uncaught rejection to the caller (see routes.ts, which is hit by both an
 * external scheduler and an in-process node-cron timer in main.ts).
 */
export async function runDailyScheduler(asOf: Date = new Date()): Promise<DailySchedulerResult> {
  const [savingsInterest, loanKol] = await Promise.all([
    runDailySavingInterestAccrual(asOf).catch((err: unknown) => {
      console.error("Daily savings interest accrual failed", err);
      return { checked: 0, posted: 0, skipped: 0, failed: 1 } satisfies SavingInterestAccrualResult;
    }),
    recalculateAllKOL().catch((err: unknown) => {
      console.error("Daily loan KOL recalculation failed", err);
      return { checked: 0, failed: 1 };
    })
  ]);

  return { date: asOf.toISOString(), savingsInterest, loanKol };
}
