import { db } from "../../lib/db.js";
import { notFound } from "../../lib/errors.js";
import { recordAudit } from "../audit-log/service.js";
import type { CreateLevyRateInput, ListLevyRatesQueryInput, UpdateLevyRateInput } from "./levy-rates.schema.js";

export async function listLevyRates(tenantId: string, query: ListLevyRatesQueryInput) {
  return db.levyRate.findMany({
    where: {
      tenantId,
      ...(query.marketId ? { marketId: query.marketId } : {}),
      ...(query.stallKind ? { stallKind: query.stallKind } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {})
    },
    orderBy: { createdAt: "asc" }
  });
}

/** Several active rates on the same market + stall kind are allowed (e.g. "Kebersihan" and "Keamanan" both apply). */
export async function createLevyRate(tenantId: string, data: CreateLevyRateInput) {
  const market = await db.market.findFirst({ where: { id: data.marketId, tenantId } });
  if (!market) throw notFound("Pasar tidak ditemukan");

  return db.$transaction(async (tx) => {
    const rate = await tx.levyRate.create({
      data: {
        tenantId,
        marketId: data.marketId,
        stallKind: data.stallKind,
        name: data.name,
        amount: data.amount,
        period: data.period
      }
    });

    await recordAudit(tx, {
      action: "levy-rate.create",
      entityType: "LevyRate",
      entityId: rate.id,
      after: { marketId: rate.marketId, stallKind: rate.stallKind, name: rate.name, amount: rate.amount.toString() }
    });

    return rate;
  });
}

export async function updateLevyRate(tenantId: string, id: string, data: UpdateLevyRateInput) {
  const rate = await db.levyRate.findFirst({ where: { id, tenantId } });
  if (!rate) throw notFound("Tarif retribusi tidak ditemukan");

  return db.$transaction(async (tx) => {
    const updated = await tx.levyRate.update({
      where: { id, tenantId },
      data: {
        ...(data.stallKind !== undefined && { stallKind: data.stallKind }),
        ...(data.name !== undefined && { name: data.name }),
        ...(data.amount !== undefined && { amount: data.amount }),
        ...(data.period !== undefined && { period: data.period }),
        ...(data.isActive !== undefined && { isActive: data.isActive })
      }
    });

    await recordAudit(tx, {
      action: "levy-rate.update",
      entityType: "LevyRate",
      entityId: id,
      before: { amount: rate.amount.toString(), isActive: rate.isActive },
      after: { amount: updated.amount.toString(), isActive: updated.isActive }
    });

    return updated;
  });
}
