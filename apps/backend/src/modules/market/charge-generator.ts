import type { ChargeGenerationResult } from "@siskop/types";
import { db } from "../../lib/db.js";
import { postChargeAccrual } from "../../lib/journal.js";
import { withoutTenantScope } from "../../lib/tenant-scope.js";
import {
  businessDate,
  isOperatingDay,
  loadOperatingCalendar,
  nextOperatingDay,
  type OperatingCalendar
} from "../../lib/operating-calendar.js";

function addPeriod(d: Date, period: "MONTHLY" | "YEARLY"): Date {
  const result = new Date(d);
  if (period === "MONTHLY") result.setUTCMonth(result.getUTCMonth() + 1);
  else result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result;
}

/** The most recent SEWA billing anniversary on/before `today`, starting from the contract's startDate. */
function currentSewaPeriodStart(startDate: Date, period: "MONTHLY" | "YEARLY", today: Date): Date {
  let cursor = new Date(startDate);
  let next = addPeriod(cursor, period);
  while (next <= today) {
    cursor = next;
    next = addPeriod(cursor, period);
  }
  return cursor;
}

/**
 * Daily charge generator (koperasi pasar F5 plan): one SEWA charge per active
 * StallContract at each MONTHLY/YEARLY billing anniversary, and one RETRIBUSI
 * charge per active DAILY LevyRate matching that contract's stall (market +
 * kind) — both gated on the tenant's operating calendar (D1: no Minggu/
 * libur), and idempotent via Charge's `@@unique([sourceId, periodStart])`.
 * `periodStart` is the conceptual anniversary/day (may fall on a closed day);
 * `dueDate` is shifted to the next operating day. Mirrors
 * modules/savings/daily-interest.ts's cross-tenant sweep + per-row transact shape.
 */
export async function runDailyChargeGeneration(asOf: Date = new Date()): Promise<ChargeGenerationResult> {
  const result: ChargeGenerationResult = { checked: 0, created: 0, skipped: 0, failed: 0 };

  const contracts = await withoutTenantScope(() =>
    db.stallContract.findMany({
      where: { isActive: true },
      select: {
        id: true,
        tenantId: true,
        memberId: true,
        stallId: true,
        startDate: true,
        rentAmount: true,
        rentPeriod: true,
        stall: { select: { kind: true, marketId: true, market: { select: { unitId: true } } } }
      }
    })
  );
  result.checked = contracts.length;

  const calendarCache = new Map<string, OperatingCalendar>();
  async function calendarFor(tenantId: string): Promise<OperatingCalendar> {
    const cached = calendarCache.get(tenantId);
    if (cached) return cached;
    const cal = await withoutTenantScope(() => loadOperatingCalendar(db, tenantId));
    calendarCache.set(tenantId, cal);
    return cal;
  }

  for (const contract of contracts) {
    try {
      const cal = await calendarFor(contract.tenantId);
      const today = businessDate(asOf);
      if (!isOperatingDay(today, cal)) {
        result.skipped++;
        continue;
      }

      const unitId = contract.stall.market.unitId;

      // rentPeriod is DB-typed as the full ChargePeriod enum, but
      // contracts.schema.ts's createStallContractSchema only ever accepts
      // MONTHLY/YEARLY at creation — DAILY here would mean the row was
      // written outside that path, so it's skipped rather than guessed at.
      if (contract.startDate <= today && contract.rentPeriod !== "DAILY") {
        const periodStart = currentSewaPeriodStart(contract.startDate, contract.rentPeriod, today);
        const existingSewa = await db.charge.findFirst({
          where: { tenantId: contract.tenantId, sourceId: contract.id, periodStart }
        });
        if (!existingSewa) {
          await db.$transaction(async (tx) => {
            const charge = await tx.charge.create({
              data: {
                tenantId: contract.tenantId,
                unitId,
                memberId: contract.memberId,
                stallId: contract.stallId,
                kind: "SEWA",
                sourceId: contract.id,
                periodStart,
                dueDate: nextOperatingDay(periodStart, cal),
                amount: contract.rentAmount
              }
            });
            await postChargeAccrual(tx, {
              tenantId: contract.tenantId,
              unitId,
              chargeId: charge.id,
              kind: "SEWA",
              amount: contract.rentAmount,
              entryDate: today,
              description: "Tagihan sewa kios"
            });
          });
          result.created++;
        }
      }

      const levyRates = await db.levyRate.findMany({
        where: {
          tenantId: contract.tenantId,
          marketId: contract.stall.marketId,
          stallKind: contract.stall.kind,
          isActive: true,
          period: "DAILY"
        }
      });
      for (const levyRate of levyRates) {
        // Disambiguates one LevyRate applying to several stalls on the same day — a bare
        // levyRate.id would collide across those stalls under Charge's @@unique([sourceId, periodStart]).
        const sourceId = `${contract.id}:${levyRate.id}`;
        const existing = await db.charge.findFirst({ where: { tenantId: contract.tenantId, sourceId, periodStart: today } });
        if (existing) continue;

        await db.$transaction(async (tx) => {
          const charge = await tx.charge.create({
            data: {
              tenantId: contract.tenantId,
              unitId,
              memberId: contract.memberId,
              stallId: contract.stallId,
              kind: "RETRIBUSI",
              sourceId,
              periodStart: today,
              dueDate: today,
              amount: levyRate.amount
            }
          });
          await postChargeAccrual(tx, {
            tenantId: contract.tenantId,
            unitId,
            chargeId: charge.id,
            kind: "RETRIBUSI",
            amount: levyRate.amount,
            entryDate: today,
            description: `Tagihan retribusi ${levyRate.name}`
          });
        });
        result.created++;
      }
    } catch (error) {
      console.error(`Daily charge generation failed for contract ${contract.id}`, error);
      result.failed++;
    }
  }

  return result;
}
