import type { DailySchedulerResult, SavingInterestAccrualResult } from "@siskop/types";
import { recalculateAllKOL } from "../../lib/kol.js";
import { runDailySavingInterestAccrual } from "../savings/daily-interest.js";

/**
 * The one daily "system date tick" for every date-driven calculation that
 * isn't triggered by a user action: savings interest accrual and loan
 * KOL/overdue reclassification today, with room for more jobs later. Each
 * job is isolated so one failing doesn't block the other — a thrown error
 * here is reported as `failed` on that job's result, never surfaced as an
 * uncaught rejection to the caller. The HTTP adapter returns 503 for partial
 * failures so Cloud Scheduler can retry the unfinished work.
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
