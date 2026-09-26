import { Prisma } from "@prisma/client";
import type { SavingInterestAccrualResult, SavingPeriodUnit } from "@siskop/types";
import { db } from "../../lib/db.js";
import { postSavingTransaction } from "../../lib/journal.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";

const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000;
const utcMonth = (date: Date) => date.getUTCFullYear() * 12 + date.getUTCMonth();
const utcYear = (date: Date) => date.getUTCFullYear();

/** Each period's calendar-boundary elapsed count and its share of the
 * SavingConfig's annual rate — same /360, /12, /1 convention as
 * calculateSavingInterest in lib/saving-calc.ts, kept in Decimal here for
 * precision. divisor = 100 * periodsPerYear, since rate is a whole percent. */
const PERIODS: Record<SavingPeriodUnit, { elapsed: (asOf: Date, since: Date) => number; divisor: number; adjective: string; noun: string }> = {
  DAILY: { elapsed: (asOf, since) => utcDay(asOf) - utcDay(since), divisor: 36_000, adjective: "harian", noun: "hari" },
  MONTHLY: { elapsed: (asOf, since) => utcMonth(asOf) - utcMonth(since), divisor: 1_200, adjective: "bulanan", noun: "bulan" },
  YEARLY: { elapsed: (asOf, since) => utcYear(asOf) - utcYear(since), divisor: 100, adjective: "tahunan", noun: "tahun" }
};

/** Authorized system sweep across tenants, run once daily for every period
 * unit. Lock and re-read each account in a short transaction so overlapping
 * requests/retries cannot credit it twice. DAILY keeps its original
 * convention: a never-accrued account is credited one day immediately (see
 * Saving.lastInterestAt in schema.prisma). A brand-new MONTHLY/YEARLY
 * account instead waits for its first full calendar period to elapse from
 * createdAt, so it isn't credited a whole month/year of interest the very
 * next day it exists. Balance, timestamp, interest transaction and journal
 * commit together. */
export async function runDailySavingInterestAccrual(asOf = new Date()): Promise<SavingInterestAccrualResult> {
  const activePeriods = Object.keys(PERIODS) as SavingPeriodUnit[];
  const savings = await withoutTenantScope(() => db.saving.findMany({
    where: { isActive: true, savingConfig: { periodUnit: { in: activePeriods }, isActive: true } },
    select: { id: true, tenantId: true }
  }));
  const result: SavingInterestAccrualResult = { checked: savings.length, posted: 0, skipped: 0, failed: 0 };
  for (const account of savings) {
    try {
      const outcome = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Saving" WHERE id = ${account.id} AND "tenantId" = ${account.tenantId} FOR UPDATE`;
        const saving = await tx.saving.findFirst({ where: { id: account.id, tenantId: account.tenantId, isActive: true, savingConfig: { periodUnit: { in: activePeriods }, isActive: true } }, include: { savingConfig: true } });
        if (!saving) return "skipped";
        const periodUnit = saving.savingConfig.periodUnit as SavingPeriodUnit;
        const period = PERIODS[periodUnit];
        const elapsed = saving.lastInterestAt
          ? period.elapsed(asOf, saving.lastInterestAt)
          : periodUnit === "DAILY" ? 1 : period.elapsed(asOf, saving.createdAt);
        if (elapsed <= 0) return "skipped";
        // Round one period's amount before multiplying by missed periods, using Decimal throughout.
        const amount = saving.balance.mul(saving.savingConfig.rate).div(period.divisor)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).mul(elapsed);
        await tx.saving.update({ where: { id: saving.id, tenantId: saving.tenantId }, data: {
          lastInterestAt: asOf, ...(amount.gt(0) ? { balance: { increment: amount } } : {})
        } });
        if (amount.lte(0)) return "skipped";
        const transaction = await tx.savingTransaction.create({ data: {
          savingId: saving.id, tenantId: saving.tenantId, type: "INTEREST", amount,
          note: `Bunga ${period.adjective} otomatis (${elapsed} ${period.noun})`
        } });
        await postSavingTransaction(tx, {
          tenantId: saving.tenantId, unitId: saving.unitId, savingTransactionId: transaction.id,
          savingConfigId: saving.savingConfigId, kind: "SAVING_INTEREST", amount,
          entryDate: asOf, description: `Bunga simpanan ${period.adjective}`
        });
        return "posted";
      });
      result[outcome]++;
    } catch (error) {
      console.error(`Interest accrual failed for saving ${account.id}`, error);
      result.failed++;
    }
  }
  return result;
}
