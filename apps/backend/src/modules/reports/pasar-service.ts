import { Prisma } from "@prisma/client";
import type { RekapHarianKolektor, TunggakanAngsuranRow, TunggakanSewaRetribusiRow } from "@siskop/types";
import { db } from "../../lib/db.js";
import { businessDate } from "../../lib/operating-calendar.js";
import { getTodayForCollector } from "../collections/service.js";

const ZERO = new Prisma.Decimal(0);

function daysOverdue(dueDate: Date, today: Date): number {
  return Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000);
}

/**
 * Per kolektor: target (what's due today, computed live via
 * getTodayForCollector — only meaningful for today, since a past day's due
 * list isn't reconstructible after the fact), tertagih/disetor/selisih from
 * that day's CollectionBatch (koperasi pasar F7 plan).
 */
export async function getRekapHarianKolektor(tenantId: string, date: Date): Promise<RekapHarianKolektor> {
  const isToday = date.getTime() === businessDate().getTime();

  const kolektorRole = await db.role.findFirst({ where: { tenantId, name: "Kolektor" } });
  const collectors = kolektorRole
    ? await db.user.findMany({ where: { tenantId, roleId: kolektorRole.id }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];

  const batches = await db.collectionBatch.findMany({ where: { tenantId, businessDate: date } });
  const batchByCollector = new Map(batches.map((b) => [b.collectorId, b]));

  const targetByCollector = new Map<string, Prisma.Decimal>();
  if (isToday) {
    for (const collector of collectors) {
      const items = await getTodayForCollector(tenantId, collector.id);
      const total = items.reduce((sum, item) => {
        let t = sum;
        if (item.amountDue) t = t.add(item.amountDue);
        for (const charge of item.charges) t = t.add(charge.amountDue);
        return t;
      }, ZERO);
      targetByCollector.set(collector.id, total);
    }
  }

  const rows = collectors.map((collector) => {
    const batch = batchByCollector.get(collector.id);
    return {
      collectorId: collector.id,
      collectorName: collector.name,
      target: isToday ? (targetByCollector.get(collector.id) ?? ZERO).toString() : null,
      tertagih: (batch?.expectedTotal ?? ZERO).toString(),
      disetor: batch?.receivedTotal ? batch.receivedTotal.toString() : null,
      selisih: batch?.variance ? batch.variance.toString() : null,
      status: batch?.status ?? ("TIDAK_ADA_SETORAN" as const)
    };
  });

  return { date: date.toISOString().slice(0, 10), rows };
}

export interface TunggakanAngsuranQueryInput {
  collectorId?: string;
  marketId?: string;
  block?: string;
}

/** Strictly-overdue (dueDate before today) ACTIVE-loan installments, filterable by kolektor/pasar/blok via each member's collector assignment and active StallContract. */
export async function getTunggakanAngsuran(tenantId: string, query: TunggakanAngsuranQueryInput): Promise<TunggakanAngsuranRow[]> {
  const today = businessDate();

  const installments = await db.loanInstallment.findMany({
    where: {
      tenantId,
      status: { not: "PAID" },
      dueDate: { lt: today },
      loan: {
        status: "ACTIVE",
        member: {
          ...(query.collectorId ? { collectorAssignments: { some: { tenantId, userId: query.collectorId } } } : {}),
          ...(query.marketId || query.block
            ? {
                stallContracts: {
                  some: {
                    isActive: true,
                    stall: {
                      ...(query.marketId ? { marketId: query.marketId } : {}),
                      ...(query.block ? { block: query.block } : {})
                    }
                  }
                }
              }
            : {})
        }
      }
    },
    orderBy: { dueDate: "asc" },
    select: {
      seq: true,
      dueDate: true,
      principalDue: true,
      interestDue: true,
      principalPaid: true,
      interestPaid: true,
      loan: {
        select: {
          id: true,
          member: {
            select: {
              id: true,
              fullName: true,
              collectorAssignments: { take: 1, select: { userId: true, user: { select: { name: true } } } },
              stallContracts: {
                where: { isActive: true },
                take: 1,
                select: { stall: { select: { code: true, block: true, market: { select: { name: true } } } } }
              }
            }
          }
        }
      }
    }
  });

  return installments.map((i) => {
    const member = i.loan.member;
    const assignment = member.collectorAssignments[0];
    const stall = member.stallContracts[0]?.stall;
    const amountDue = i.principalDue.plus(i.interestDue).sub(i.principalPaid).sub(i.interestPaid);
    return {
      loanId: i.loan.id,
      memberId: member.id,
      memberName: member.fullName,
      collectorId: assignment?.userId ?? null,
      collectorName: assignment?.user.name ?? null,
      marketName: stall?.market.name ?? null,
      block: stall?.block ?? null,
      stallCode: stall?.code ?? null,
      installmentSeq: i.seq,
      dueDate: i.dueDate.toISOString().slice(0, 10),
      amountDue: amountDue.toString(),
      daysOverdue: daysOverdue(i.dueDate, today)
    };
  });
}

export interface TunggakanSewaRetribusiQueryInput {
  marketId?: string;
  block?: string;
  memberId?: string;
}

/** Strictly-overdue (dueDate before today) sewa/retribusi Charges, filterable by pasar/blok/pedagang. */
export async function getTunggakanSewaRetribusi(
  tenantId: string,
  query: TunggakanSewaRetribusiQueryInput
): Promise<TunggakanSewaRetribusiRow[]> {
  const today = businessDate();

  const charges = await db.charge.findMany({
    where: {
      tenantId,
      status: { not: "PAID" },
      dueDate: { lt: today },
      ...(query.memberId ? { memberId: query.memberId } : {}),
      stall: {
        ...(query.marketId ? { marketId: query.marketId } : {}),
        ...(query.block ? { block: query.block } : {})
      }
    },
    orderBy: { dueDate: "asc" },
    include: {
      member: { select: { fullName: true } },
      stall: { select: { code: true, block: true, market: { select: { name: true } } } }
    }
  });

  return charges.map((c) => ({
    chargeId: c.id,
    memberId: c.memberId,
    memberName: c.member.fullName,
    marketName: c.stall.market.name,
    block: c.stall.block,
    stallCode: c.stall.code,
    kind: c.kind,
    dueDate: c.dueDate.toISOString().slice(0, 10),
    amountDue: c.amount.sub(c.paidAmount).toString(),
    daysOverdue: daysOverdue(c.dueDate, today)
  }));
}
