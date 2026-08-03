import type { Prisma } from "@prisma/client";
import { ErrorCode } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { calculateLoan } from "../../lib/loan-calc.js";
import { recalculateKOL } from "../../lib/kol.js";
import { postLoanDisbursement, postLoanPayment, splitPrincipalAndInterest } from "../../lib/journal.js";
import { getDefaultUnitId } from "../../lib/units.js";
import { hasPokokSaving } from "../savings/service.js";
import type {
  CreateLoanConfigInput,
  CreateLoanInput,
  ListLoansQueryInput,
  LoanPaymentInput,
  UpdateLoanConfigInput
} from "./schema.js";

// ── Config ────────────────────────────────────────────────────────────────

export async function listLoanConfigs(tenantId: string) {
  return db.loanConfig.findMany({ where: { tenantId, isActive: true }, orderBy: { createdAt: "asc" } });
}

export async function createLoanConfig(tenantId: string, data: CreateLoanConfigInput) {
  return db.loanConfig.create({
    data: {
      tenantId,
      name: data.name,
      type: data.type,
      rateType: data.rateType,
      rate: data.rate,
      maxTermMonths: data.maxTermMonths,
      isActive: true
    }
  });
}

export async function updateLoanConfig(tenantId: string, id: string, data: UpdateLoanConfigInput) {
  const config = await db.loanConfig.findFirst({ where: { id, tenantId } });
  if (!config) throw notFound("Konfigurasi pinjaman tidak ditemukan");
  return db.loanConfig.update({ where: { id, tenantId }, data });
}

// ── Loans ─────────────────────────────────────────────────────────────────

export async function listLoans(tenantId: string, query: ListLoansQueryInput) {
  const { page, limit, search, status, kolCategory, memberId, loanConfigId } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.LoanWhereInput = {
    tenantId,
    ...(status ? { status } : {}),
    ...(kolCategory ? { kolCategory } : {}),
    ...(memberId ? { memberId } : {}),
    ...(loanConfigId ? { loanConfigId } : {}),
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
    db.loan.findMany({
      where,
      skip,
      take: limit,
      include: {
        member: { select: { memberId: true, fullName: true, accountNumber: true } },
        loanConfig: { select: { name: true, type: true } }
      },
      orderBy: { createdAt: "desc" }
    }),
    db.loan.count({ where })
  ]);

  return { items, meta: { page, limit, total } };
}

export async function getLoanById(tenantId: string, id: string) {
  const loan = await db.loan.findFirst({
    where: { id, tenantId },
    include: {
      member: { select: { memberId: true, fullName: true, accountNumber: true } },
      loanConfig: true,
      payments: { include: { createdByUser: { select: { name: true } } }, orderBy: { paidAt: "desc" } }
    }
  });
  if (!loan) throw notFound("Pinjaman tidak ditemukan");
  return loan;
}

/**
 * `createdBy` is accepted for API-shape parity with Savings (and because the
 * caller is who initiated the disbursement) but not persisted — `Loan` has no
 * `createdBy` column, unlike `SavingTransaction`/`LoanPayment`. Ported as-is.
 */
export async function createLoan(tenantId: string, data: CreateLoanInput, _createdBy: string) {
  const member = await db.member.findFirst({ where: { id: data.memberId, tenantId, isActive: true } });
  if (!member) throw notFound("Anggota tidak ditemukan");

  const memberHasPokok = await hasPokokSaving(tenantId, data.memberId);
  if (!memberHasPokok) {
    throw new AppError(
      ErrorCode.MEMBER_HAS_NO_POKOK_SAVING,
      "Anggota belum memiliki simpanan pokok aktif"
    );
  }

  // Rather than throwing, a member with an existing active/pending loan gets
  // a 200 + hasExistingLoan flag — the caller must resubmit with force:true
  // to knowingly create a second loan. Ported as-is (intentional, tested).
  if (!data.force) {
    const existingLoan = await db.loan.findFirst({
      where: { tenantId, memberId: data.memberId, status: { in: ["ACTIVE", "PENDING"] } }
    });
    if (existingLoan) {
      return {
        hasExistingLoan: true as const,
        existingLoan: {
          id: existingLoan.id,
          principalAmount: existingLoan.principalAmount.toString(),
          remainingAmount: existingLoan.remainingAmount.toString()
        }
      };
    }
  }

  const loanConfig = await db.loanConfig.findFirst({
    where: { id: data.loanConfigId, tenantId, isActive: true }
  });
  if (!loanConfig) throw notFound("Jenis pembiayaan tidak ditemukan");

  if (data.termMonths > loanConfig.maxTermMonths) {
    throw new AppError(
      ErrorCode.TERM_EXCEEDS_MAX,
      `Tenor maksimal adalah ${loanConfig.maxTermMonths} bulan`
    );
  }

  const calc = calculateLoan(
    data.principalAmount,
    Number(loanConfig.rate),
    data.termMonths,
    loanConfig.type,
    loanConfig.rateType
  );

  const disbursedAt = data.disbursedAt ? new Date(data.disbursedAt) : new Date();
  const unitId = await getDefaultUnitId(tenantId);

  return db.$transaction(async (tx) => {
    const loan = await tx.loan.create({
      data: {
        tenantId,
        unitId,
        memberId: data.memberId,
        loanConfigId: data.loanConfigId,
        principalAmount: data.principalAmount,
        totalAmount: calc.totalAmount,
        termMonths: data.termMonths,
        monthlyPayment: calc.monthlyPayment,
        remainingAmount: calc.totalAmount,
        status: "ACTIVE",
        kolCategory: "LANCAR",
        disbursedAt
      },
      include: {
        loanConfig: true,
        member: { select: { memberId: true, fullName: true, accountNumber: true } }
      }
    });

    await postLoanDisbursement(tx, {
      tenantId,
      loanId: loan.id,
      loanConfigId: data.loanConfigId,
      amount: data.principalAmount,
      entryDate: disbursedAt,
      description: "Pencairan pinjaman"
    });

    return loan;
  });
}

export async function recordLoanPayment(
  tenantId: string,
  loanId: string,
  data: LoanPaymentInput,
  createdBy: string
) {
  const result = await db.$transaction(async (tx) => {
    const loan = await tx.loan.findUnique({ where: { id: loanId } });
    if (!loan || loan.tenantId !== tenantId) throw notFound("Pinjaman tidak ditemukan");
    if (loan.status !== "ACTIVE") {
      throw new AppError(ErrorCode.LOAN_NOT_ACTIVE, "Pinjaman tidak dalam status aktif");
    }

    const paidAt = new Date(data.paidAt);

    const payment = await tx.loanPayment.create({
      data: {
        loanId,
        tenantId,
        amount: data.amount,
        penalty: data.penalty,
        paidAt,
        dueDate: new Date(data.dueDate),
        note: data.note,
        createdBy
      }
    });

    // No per-installment amortization schedule exists — the split is a
    // documented flat-ratio approximation (see lib/journal.ts).
    const { principal, interest } = splitPrincipalAndInterest(
      data.amount,
      Number(loan.principalAmount),
      Number(loan.totalAmount)
    );

    await postLoanPayment(tx, {
      tenantId,
      loanPaymentId: payment.id,
      loanConfigId: loan.loanConfigId,
      principalAmount: principal,
      interestAmount: interest,
      penaltyAmount: data.penalty,
      entryDate: paidAt,
      description: "Pembayaran cicilan pinjaman"
    });

    const newRemaining = Math.max(0, Number(loan.remainingAmount) - data.amount);
    const newStatus = newRemaining <= 0 ? ("COMPLETED" as const) : ("ACTIVE" as const);

    await tx.loan.update({
      where: { id: loanId, tenantId },
      data: { remainingAmount: newRemaining, status: newStatus }
    });

    return { loanId, newRemaining, status: newStatus };
  });

  // Recalculated outside the transaction — recalculateKOL does its own read/write.
  const kolCategory = await recalculateKOL(loanId);
  return { ...result, kolCategory };
}

export async function getOverdueLoans(tenantId: string) {
  const loans = await db.loan.findMany({
    where: { tenantId, status: "ACTIVE", kolCategory: { not: "LANCAR" } },
    include: {
      member: { select: { memberId: true, fullName: true, accountNumber: true } },
      loanConfig: { select: { name: true, type: true } },
      payments: { orderBy: { paidAt: "desc" }, take: 1 }
    },
    orderBy: [{ kolCategory: "desc" }, { updatedAt: "asc" }]
  });

  return loans.map(({ payments, ...loan }) => ({
    ...loan,
    lastPaymentAt: payments[0]?.paidAt ?? null
  }));
}
