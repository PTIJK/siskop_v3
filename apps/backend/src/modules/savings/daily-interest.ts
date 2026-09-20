import { Prisma } from "@prisma/client";
import type { SavingInterestAccrualResult } from "@siskop/types";
import { db } from "../../lib/db.js";
import { postSavingTransaction } from "../../lib/journal.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";

const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86_400_000;

/** Authorized system sweep across tenants. Lock and re-read each account in a
 * short transaction so overlapping requests/retries cannot credit it twice.
 * First accrual credits one day; later runs catch up from lastInterestAt.
 * Balance, timestamp, interest transaction and journal commit together. */
export async function runDailySavingInterestAccrual(asOf = new Date()): Promise<SavingInterestAccrualResult> {
  const savings = await withoutTenantScope(() => db.saving.findMany({
    where: { isActive: true, savingConfig: { periodUnit: "DAILY", isActive: true } },
    select: { id: true, tenantId: true }
  }));
  const result: SavingInterestAccrualResult = { checked: savings.length, posted: 0, skipped: 0, failed: 0 };
  for (const account of savings) {
    try {
      const outcome = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Saving" WHERE id = ${account.id} AND "tenantId" = ${account.tenantId} FOR UPDATE`;
        const saving = await tx.saving.findFirst({ where: { id: account.id, tenantId: account.tenantId, isActive: true, savingConfig: { periodUnit: "DAILY", isActive: true } }, include: { savingConfig: true } });
        if (!saving) return "skipped";
        const days = saving.lastInterestAt ? utcDay(asOf) - utcDay(saving.lastInterestAt) : 1;
        if (days <= 0) return "skipped";
        // Preserve the existing annual /360 convention and round each daily
        // amount before multiplying by missed days, using Decimal throughout.
        const amount = saving.balance.mul(saving.savingConfig.rate).div(36_000)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).mul(days);
        await tx.saving.update({ where: { id: saving.id, tenantId: saving.tenantId }, data: {
          lastInterestAt: asOf, ...(amount.gt(0) ? { balance: { increment: amount } } : {})
        } });
        if (amount.lte(0)) return "skipped";
        const transaction = await tx.savingTransaction.create({ data: {
          savingId: saving.id, tenantId: saving.tenantId, type: "INTEREST", amount,
          note: `Bunga harian otomatis (${days} hari)`
        } });
        await postSavingTransaction(tx, {
          tenantId: saving.tenantId, unitId: saving.unitId, savingTransactionId: transaction.id,
          savingConfigId: saving.savingConfigId, kind: "SAVING_INTEREST", amount,
          entryDate: asOf, description: "Bunga simpanan harian"
        });
        return "posted";
      });
      result[outcome]++;
    } catch (error) {
      console.error(`Daily interest accrual failed for saving ${account.id}`, error);
      result.failed++;
    }
  }
  return result;
}
