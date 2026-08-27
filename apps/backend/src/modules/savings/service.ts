import type { Prisma } from "@prisma/client";
import { ErrorCode } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { postSavingTransaction } from "../../lib/journal.js";
import { getDefaultUnitId } from "../../lib/units.js";
import type {
  CreateSavingConfigInput,
  CreateSavingInput,
  ListSavingTransactionsQueryInput,
  ListSavingsQueryInput,
  SavingTransactionInput,
  UpdateSavingConfigInput
} from "./schema.js";

// ── Config ────────────────────────────────────────────────────────────────
// Package/entitlement gating (quota freeze on custom configs) is Phase 2 — no
// tenant has a package assigned yet, so every config is unfrozen in Phase 1.

export async function listSavingConfigs(tenantId: string) {
  return db.savingConfig.findMany({
    where: { tenantId, isActive: true },
    orderBy: { createdAt: "asc" }
  });
}

export async function createSavingConfig(tenantId: string, data: CreateSavingConfigInput) {
  return db.savingConfig.create({
    data: {
      tenantId,
      name: data.name,
      type: data.type,
      rateType: data.rateType,
      rate: data.rate,
      periodUnit: data.periodUnit,
      isDefault: false,
      isActive: true
    }
  });
}

export async function updateSavingConfig(tenantId: string, id: string, data: UpdateSavingConfigInput) {
  const config = await db.savingConfig.findFirst({ where: { id, tenantId } });
  if (!config) throw notFound("Konfigurasi simpanan tidak ditemukan");
  return db.savingConfig.update({ where: { id, tenantId }, data });
}

// ── Saving accounts ───────────────────────────────────────────────────────

export async function listSavings(tenantId: string, query: ListSavingsQueryInput) {
  const { page, limit, search, memberId, type } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.SavingWhereInput = {
    tenantId,
    isActive: true,
    ...(memberId ? { memberId } : {}),
    ...(type ? { savingConfig: { type } } : {}),
    ...(search
      ? {
          OR: [
            { member: { fullName: { contains: search, mode: "insensitive" } } },
            { member: { memberId: { contains: search, mode: "insensitive" } } }
          ]
        }
      : {})
  };

  const [items, total] = await Promise.all([
    db.saving.findMany({
      where,
      skip,
      take: limit,
      include: {
        member: { select: { memberId: true, fullName: true, accountNumber: true } },
        savingConfig: true
      },
      orderBy: { createdAt: "desc" }
    }),
    db.saving.count({ where })
  ]);

  return { items, meta: { page, limit, total } };
}

export async function getSavingById(tenantId: string, id: string) {
  const saving = await db.saving.findFirst({
    where: { id, tenantId },
    include: {
      member: { select: { memberId: true, fullName: true, accountNumber: true } },
      savingConfig: true,
      transactions: { orderBy: { createdAt: "desc" }, take: 20 }
    }
  });
  if (!saving) throw notFound("Rekening simpanan tidak ditemukan");
  return saving;
}

export async function createSaving(tenantId: string, data: CreateSavingInput, createdBy: string) {
  const member = await db.member.findFirst({
    where: { id: data.memberId, tenantId, isActive: true }
  });
  if (!member) throw notFound("Anggota tidak ditemukan");

  const config = await db.savingConfig.findFirst({
    where: { id: data.savingConfigId, tenantId, isActive: true }
  });
  if (!config) throw notFound("Konfigurasi simpanan tidak ditemukan");

  const unitId = await getDefaultUnitId(tenantId);

  return db.$transaction(async (tx) => {
    const saving = await tx.saving.create({
      data: {
        tenantId,
        unitId,
        memberId: data.memberId,
        savingConfigId: data.savingConfigId,
        balance: data.initialDeposit,
        isActive: true
      }
    });

    // Even account creation posts to the journal when there's an opening
    // deposit — matches the pre-rescaffold system exactly.
    if (data.initialDeposit > 0) {
      const transaction = await tx.savingTransaction.create({
        data: {
          savingId: saving.id,
          tenantId,
          type: "DEPOSIT",
          amount: data.initialDeposit,
          note: "Setoran awal",
          createdBy
        }
      });

      await postSavingTransaction(tx, {
        tenantId,
        savingTransactionId: transaction.id,
        savingConfigId: data.savingConfigId,
        kind: "DEPOSIT",
        amount: data.initialDeposit,
        entryDate: transaction.createdAt,
        description: "Setoran awal simpanan"
      });
    }

    return saving;
  });
}

export async function listSavingTransactions(
  tenantId: string,
  savingId: string,
  query: ListSavingTransactionsQueryInput
) {
  const saving = await db.saving.findFirst({ where: { id: savingId, tenantId } });
  if (!saving) throw notFound("Rekening simpanan tidak ditemukan");

  const { page, limit } = query;
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    db.savingTransaction.findMany({
      where: { savingId, tenantId },
      skip,
      take: limit,
      include: { createdByUser: { select: { name: true } } },
      orderBy: { createdAt: "desc" }
    }),
    db.savingTransaction.count({ where: { savingId, tenantId } })
  ]);

  return { items, meta: { page, limit, total } };
}

export async function depositToSaving(
  tenantId: string,
  savingId: string,
  data: SavingTransactionInput,
  createdBy: string
) {
  return db.$transaction(async (tx) => {
    const saving = await tx.saving.findUnique({ where: { id: savingId } });
    if (!saving || saving.tenantId !== tenantId) throw notFound("Rekening simpanan tidak ditemukan");

    await tx.saving.update({ where: { id: savingId, tenantId }, data: { balance: { increment: data.amount } } });

    const transaction = await tx.savingTransaction.create({
      data: { savingId, tenantId, type: "DEPOSIT", amount: data.amount, note: data.note, createdBy }
    });

    await postSavingTransaction(tx, {
      tenantId,
      savingTransactionId: transaction.id,
      savingConfigId: saving.savingConfigId,
      kind: "DEPOSIT",
      amount: data.amount,
      entryDate: transaction.createdAt,
      description: "Setoran simpanan"
    });

    return transaction;
  });
}

export async function withdrawFromSaving(
  tenantId: string,
  savingId: string,
  data: SavingTransactionInput,
  createdBy: string
) {
  return db.$transaction(async (tx) => {
    const saving = await tx.saving.findUnique({
      where: { id: savingId },
      include: { savingConfig: true }
    });
    if (!saving || saving.tenantId !== tenantId) throw notFound("Rekening simpanan tidak ditemukan");

    if (Number(saving.balance) < data.amount) {
      throw new AppError(ErrorCode.INSUFFICIENT_BALANCE, "Saldo tidak mencukupi");
    }

    // Simpanan pokok (mandatory principal savings) cannot be withdrawn while
    // the member still has an active loan.
    if (saving.savingConfig.type === "POKOK") {
      const activeLoan = await tx.loan.findFirst({
        where: { tenantId, memberId: saving.memberId, status: "ACTIVE" }
      });
      if (activeLoan) {
        throw new AppError(
          ErrorCode.CANNOT_WITHDRAW_POKOK,
          "Simpanan pokok tidak dapat ditarik selama masih ada pinjaman aktif"
        );
      }
    }

    await tx.saving.update({ where: { id: savingId, tenantId }, data: { balance: { decrement: data.amount } } });

    const transaction = await tx.savingTransaction.create({
      data: { savingId, tenantId, type: "WITHDRAWAL", amount: data.amount, note: data.note, createdBy }
    });

    await postSavingTransaction(tx, {
      tenantId,
      savingTransactionId: transaction.id,
      savingConfigId: saving.savingConfigId,
      kind: "WITHDRAWAL",
      amount: data.amount,
      entryDate: transaction.createdAt,
      description: "Penarikan simpanan"
    });

    return transaction;
  });
}

/** Cross-module dependency: Loans requires this before issuing a loan. */
export async function hasPokokSaving(tenantId: string, memberId: string): Promise<boolean> {
  const count = await db.saving.count({
    where: { tenantId, memberId, isActive: true, savingConfig: { type: "POKOK" } }
  });
  return count > 0;
}
