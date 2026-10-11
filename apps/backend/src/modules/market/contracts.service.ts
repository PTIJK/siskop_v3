import { ErrorCode } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { businessDate } from "../../lib/operating-calendar.js";
import { recordAudit } from "../audit-log/service.js";
import type { CreateStallContractInput, EndStallContractInput, ListStallContractsQueryInput } from "./contracts.schema.js";

/** Denormalized for the frontend's kontrak list (Pasar/Kios/Anggota columns) — no separate lookups needed. */
export async function listStallContracts(tenantId: string, query: ListStallContractsQueryInput) {
  const contracts = await db.stallContract.findMany({
    where: {
      tenantId,
      ...(query.stallId ? { stallId: query.stallId } : {}),
      ...(query.memberId ? { memberId: query.memberId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {})
    },
    include: {
      member: { select: { fullName: true } },
      stall: { select: { code: true, marketId: true, market: { select: { name: true } } } }
    },
    orderBy: { createdAt: "desc" }
  });

  return contracts.map(({ member, stall, ...contract }) => ({
    ...contract,
    memberName: member.fullName,
    stallCode: stall.code,
    marketId: stall.marketId,
    marketName: stall.market.name
  }));
}

/**
 * "Satu kios hanya punya satu kontrak aktif" (F5 plan) — enforced here, not by
 * a DB constraint: two INACTIVE historical contracts for the same stall are
 * perfectly valid, only a second *active* one is rejected.
 */
export async function createStallContract(tenantId: string, data: CreateStallContractInput) {
  const stall = await db.stall.findFirst({ where: { id: data.stallId, tenantId } });
  if (!stall) throw notFound("Kios tidak ditemukan");

  const member = await db.member.findFirst({ where: { id: data.memberId, tenantId } });
  if (!member) throw notFound("Anggota tidak ditemukan");

  const activeContract = await db.stallContract.findFirst({ where: { tenantId, stallId: data.stallId, isActive: true } });
  if (activeContract) throw new AppError(ErrorCode.STALL_ALREADY_OCCUPIED, `Kios ${stall.code} sudah memiliki kontrak aktif`);

  return db.$transaction(async (tx) => {
    const contract = await tx.stallContract.create({
      data: {
        tenantId,
        stallId: data.stallId,
        memberId: data.memberId,
        startDate: data.startDate,
        rentAmount: data.rentAmount,
        rentPeriod: data.rentPeriod
      }
    });

    await tx.stall.update({ where: { id: data.stallId, tenantId }, data: { status: "OCCUPIED" } });

    await recordAudit(tx, {
      action: "stall-contract.create",
      entityType: "StallContract",
      entityId: contract.id,
      after: { stallId: contract.stallId, memberId: contract.memberId, rentAmount: contract.rentAmount.toString() }
    });

    return contract;
  });
}

export async function endStallContract(tenantId: string, id: string, data: EndStallContractInput) {
  const contract = await db.stallContract.findFirst({ where: { id, tenantId } });
  if (!contract) throw notFound("Kontrak tidak ditemukan");
  if (!contract.isActive) throw conflict("Kontrak ini sudah tidak aktif");

  return db.$transaction(async (tx) => {
    const updated = await tx.stallContract.update({
      where: { id, tenantId },
      data: { isActive: false, endDate: data.endDate ?? businessDate() }
    });

    await tx.stall.update({ where: { id: contract.stallId, tenantId }, data: { status: "AVAILABLE" } });

    await recordAudit(tx, {
      action: "stall-contract.end",
      entityType: "StallContract",
      entityId: id,
      before: { isActive: true },
      after: { isActive: false, endDate: updated.endDate }
    });

    return updated;
  });
}
