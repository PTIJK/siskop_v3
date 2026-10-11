import { db } from "../../lib/db.js";
import { conflict, notFound } from "../../lib/errors.js";
import { ensureUnitOfType } from "../../lib/units.js";
import { recordAudit } from "../audit-log/service.js";
import type { CreateMarketInput, CreateStallInput, ListStallsQueryInput, UpdateMarketInput, UpdateStallInput } from "./schema.js";

export async function listMarkets(tenantId: string) {
  return db.market.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
}

/**
 * Resolves the tenant's JASA unit (creating "Pengelola Pasar" on the first
 * market — F3 plan) so a market's unitId is never client-supplied, same as
 * every other financial row's unitId (CLAUDE.md rule 1).
 */
export async function createMarket(tenantId: string, data: CreateMarketInput) {
  const duplicate = await db.market.findFirst({ where: { tenantId, name: data.name } });
  if (duplicate) throw conflict(`Pasar "${data.name}" sudah ada`);

  return db.$transaction(async (tx) => {
    const unitId = await ensureUnitOfType(tx, tenantId, "JASA", "Pengelola Pasar");
    const market = await tx.market.create({
      data: { tenantId, unitId, name: data.name, address: data.address ?? null }
    });

    await recordAudit(tx, {
      action: "market.create",
      entityType: "Market",
      entityId: market.id,
      after: { name: market.name, unitId: market.unitId }
    });

    return market;
  });
}

export async function updateMarket(tenantId: string, id: string, data: UpdateMarketInput) {
  const market = await db.market.findFirst({ where: { id, tenantId } });
  if (!market) throw notFound("Pasar tidak ditemukan");

  if (data.name && data.name !== market.name) {
    const duplicate = await db.market.findFirst({ where: { tenantId, name: data.name } });
    if (duplicate) throw conflict(`Pasar "${data.name}" sudah ada`);
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.market.update({
      where: { id, tenantId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.isActive !== undefined && { isActive: data.isActive })
      }
    });

    await recordAudit(tx, {
      action: "market.update",
      entityType: "Market",
      entityId: id,
      before: { name: market.name, isActive: market.isActive },
      after: { name: updated.name, isActive: updated.isActive }
    });

    return updated;
  });
}

export async function listStalls(tenantId: string, query: ListStallsQueryInput) {
  return db.stall.findMany({
    where: {
      tenantId,
      ...(query.marketId ? { marketId: query.marketId } : {}),
      ...(query.block ? { block: query.block } : {}),
      ...(query.status ? { status: query.status } : {})
    },
    orderBy: [{ block: "asc" }, { code: "asc" }]
  });
}

export async function createStall(tenantId: string, data: CreateStallInput) {
  const market = await db.market.findFirst({ where: { id: data.marketId, tenantId } });
  if (!market) throw notFound("Pasar tidak ditemukan");

  const duplicate = await db.stall.findFirst({ where: { tenantId, marketId: data.marketId, code: data.code } });
  if (duplicate) throw conflict(`Kode kios ${data.code} sudah digunakan di pasar ini`);

  return db.$transaction(async (tx) => {
    const stall = await tx.stall.create({
      data: {
        tenantId,
        marketId: data.marketId,
        code: data.code,
        block: data.block ?? null,
        kind: data.kind,
        areaM2: data.areaM2 ?? null
      }
    });

    await recordAudit(tx, {
      action: "stall.create",
      entityType: "Stall",
      entityId: stall.id,
      after: { code: stall.code, marketId: stall.marketId, kind: stall.kind }
    });

    return stall;
  });
}

export async function updateStall(tenantId: string, id: string, data: UpdateStallInput) {
  const stall = await db.stall.findFirst({ where: { id, tenantId } });
  if (!stall) throw notFound("Kios tidak ditemukan");

  if (data.code && data.code !== stall.code) {
    const duplicate = await db.stall.findFirst({ where: { tenantId, marketId: stall.marketId, code: data.code } });
    if (duplicate) throw conflict(`Kode kios ${data.code} sudah digunakan di pasar ini`);
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.stall.update({
      where: { id, tenantId },
      data: {
        ...(data.code !== undefined && { code: data.code }),
        ...(data.block !== undefined && { block: data.block }),
        ...(data.kind !== undefined && { kind: data.kind }),
        ...(data.areaM2 !== undefined && { areaM2: data.areaM2 }),
        ...(data.status !== undefined && { status: data.status })
      }
    });

    await recordAudit(tx, {
      action: "stall.update",
      entityType: "Stall",
      entityId: id,
      before: { status: stall.status },
      after: { status: updated.status }
    });

    return updated;
  });
}
