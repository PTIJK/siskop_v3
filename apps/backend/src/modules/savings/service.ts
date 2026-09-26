import { Prisma, type TransactionType } from "@prisma/client";
import { endOfDay, parseISO, startOfDay } from "date-fns";
import { ErrorCode, type MemberSavingsSummary, type SavingStatement } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { postSavingTransaction } from "../../lib/journal.js";
import { recordAudit } from "../audit-log/service.js";
import { getDefaultUnitId } from "../../lib/units.js";
import { validateRegulatoryRate } from "../../lib/regulatory-config.js";
import type {
  CreateSavingConfigInput,
  CreateSavingInput,
  ListSavingTransactionsQueryInput,
  ListSavingsQueryInput,
  SavingStatementQueryInput,
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
  validateRegulatoryRate("SAVING", data.rate);
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
  if (data.rate !== undefined) validateRegulatoryRate("SAVING", data.rate);
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

/**
 * The Simpanan list grouped by member: paginates over members (not savings) so
 * a member with several accounts appears exactly once per page.
 */
export async function listSavingsByMember(
  tenantId: string,
  query: ListSavingsQueryInput
): Promise<{ items: MemberSavingsSummary[]; meta: { page: number; limit: number; total: number } }> {
  const { page, limit, search, memberId, type } = query;
  const skip = (page - 1) * limit;

  const savingWhere: Prisma.SavingWhereInput = {
    tenantId,
    isActive: true,
    ...(type ? { savingConfig: { type } } : {})
  };
  const where: Prisma.MemberWhereInput = {
    tenantId,
    savings: { some: savingWhere },
    ...(memberId ? { id: memberId } : {}),
    ...(search
      ? {
          OR: [
            { fullName: { contains: search, mode: "insensitive" } },
            { memberId: { contains: search, mode: "insensitive" } }
          ]
        }
      : {})
  };

  const [members, total] = await Promise.all([
    db.member.findMany({
      where,
      skip,
      take: limit,
      select: {
        id: true,
        memberId: true,
        fullName: true,
        accountNumber: true,
        savings: {
          where: savingWhere,
          select: { id: true, balance: true, savingConfig: { select: { name: true, type: true } } },
          orderBy: [{ savingConfig: { type: "asc" } }, { createdAt: "asc" }]
        }
      },
      orderBy: [{ fullName: "asc" }, { id: "asc" }]
    }),
    db.member.count({ where })
  ]);

  const items = members.map((m) => ({
    memberId: m.id,
    memberNumber: m.memberId,
    fullName: m.fullName,
    accountNumber: m.accountNumber,
    totalBalance: m.savings.reduce((sum, s) => sum.add(s.balance), new Prisma.Decimal(0)).toFixed(2),
    savings: m.savings.map((s) => ({
      id: s.id,
      name: s.savingConfig.name,
      type: s.savingConfig.type,
      balance: s.balance.toFixed(2)
    }))
  }));

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
        unitId: saving.unitId,
        savingTransactionId: transaction.id,
        savingConfigId: data.savingConfigId,
        kind: "DEPOSIT",
        amount: data.initialDeposit,
        entryDate: transaction.createdAt,
        description: "Setoran awal simpanan"
      });
    }

    await recordAudit(tx, {
      action: "saving.create",
      entityType: "Saving",
      entityId: saving.id,
      after: { memberId: saving.memberId, savingConfigId: saving.savingConfigId, balance: saving.balance }
    });

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

// WITHDRAWAL is the only balance-decreasing type — an explicit check, not a
// DEPOSIT one, so a future credit type defaults safely (same rule as
// reports/regulatory-service.ts#memberSavingsBreakdownAsOf).
function signedAmount(type: TransactionType, amount: Prisma.Decimal): Prisma.Decimal {
  return type === "WITHDRAWAL" ? amount.neg() : amount;
}

/**
 * Rekening Koran for one saving account. No balance snapshots are stored, so
 * the closing balance is today's `Saving.balance` minus everything posted after
 * the period, and each row's running balance walks forward from the opening
 * balance. Rows are oldest first, like a printed bank statement.
 */
export async function getSavingStatement(
  tenantId: string,
  savingId: string,
  query: SavingStatementQueryInput
): Promise<SavingStatement> {
  const saving = await db.saving.findFirst({
    where: { id: savingId, tenantId },
    select: {
      id: true,
      balance: true,
      member: { select: { memberId: true, fullName: true } },
      savingConfig: { select: { name: true, type: true } }
    }
  });
  if (!saving) throw notFound("Rekening simpanan tidak ditemukan");

  const start = startOfDay(parseISO(query.from));
  const end = endOfDay(parseISO(query.to));
  const [laterSums, transactions] = await Promise.all([
    db.savingTransaction.groupBy({
      by: ["type"],
      where: { savingId, tenantId, createdAt: { gt: end } },
      _sum: { amount: true }
    }),
    db.savingTransaction.findMany({
      where: { savingId, tenantId, createdAt: { gte: start, lte: end } },
      include: { createdByUser: { select: { name: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    })
  ]);

  const zero = new Prisma.Decimal(0);
  const postedAfter = laterSums.reduce((sum, g) => sum.add(signedAmount(g.type, g._sum.amount ?? zero)), zero);
  const closingBalance = saving.balance.sub(postedAfter);
  const openingBalance = transactions.reduce((bal, t) => bal.sub(signedAmount(t.type, t.amount)), closingBalance);

  let running = openingBalance;
  let totalDebit = zero;
  let totalCredit = zero;
  const rows = transactions.map((t) => {
    const isDebit = t.type === "WITHDRAWAL";
    running = running.add(signedAmount(t.type, t.amount));
    if (isDebit) totalDebit = totalDebit.add(t.amount);
    else totalCredit = totalCredit.add(t.amount);
    return {
      id: t.id,
      date: t.createdAt.toISOString(),
      type: t.type,
      note: t.note,
      debit: (isDebit ? t.amount : zero).toString(),
      credit: (isDebit ? zero : t.amount).toString(),
      balance: running.toString(),
      createdByName: t.createdByUser?.name ?? null
    };
  });

  return {
    saving: {
      id: saving.id,
      configName: saving.savingConfig.name,
      type: saving.savingConfig.type,
      member: saving.member
    },
    period: { from: query.from, to: query.to },
    openingBalance: openingBalance.toString(),
    totalDebit: totalDebit.toString(),
    totalCredit: totalCredit.toString(),
    closingBalance: closingBalance.toString(),
    rows
  };
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
      unitId: saving.unitId,
      savingTransactionId: transaction.id,
      savingConfigId: saving.savingConfigId,
      kind: "DEPOSIT",
      amount: data.amount,
      entryDate: transaction.createdAt,
      description: "Setoran simpanan"
    });

    await recordAudit(tx, {
      action: "saving.deposit",
      entityType: "Saving",
      entityId: savingId,
      before: { balance: saving.balance },
      after: { balance: saving.balance.add(data.amount), amount: new Prisma.Decimal(data.amount) }
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
      unitId: saving.unitId,
      savingTransactionId: transaction.id,
      savingConfigId: saving.savingConfigId,
      kind: "WITHDRAWAL",
      amount: data.amount,
      entryDate: transaction.createdAt,
      description: "Penarikan simpanan"
    });

    await recordAudit(tx, {
      action: "saving.withdraw",
      entityType: "Saving",
      entityId: savingId,
      before: { balance: saving.balance },
      after: { balance: saving.balance.sub(data.amount), amount: new Prisma.Decimal(data.amount) }
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

export { runDailySavingInterestAccrual } from "./daily-interest.js";
