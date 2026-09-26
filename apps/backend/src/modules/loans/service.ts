import { Prisma } from "@prisma/client";
import { addMonths, differenceInCalendarDays } from "date-fns";
import { ErrorCode, type BmppHeadroom, type InstallmentFrequency, type LoanType, type RateType } from "@siskop/types";
import { db } from "../../lib/db.js";
import { AppError, notFound, validationError } from "../../lib/errors.js";
import { calculateLoan } from "../../lib/loan-calc.js";
import { buildSchedule } from "../../lib/installment-schedule.js";
import { loadOperatingCalendar } from "../../lib/operating-calendar.js";
import { allocatePayment } from "../../lib/loan-allocation.js";
import { REGULATORY_CAPS, validateRegulatoryRate, validateRelatedPartyLoanLimit } from "../../lib/regulatory-config.js";
import { recalculateKOL } from "../../lib/kol.js";
import { postLoanDisbursement, postLoanPayment } from "../../lib/journal.js";
import { resolveUnitId } from "../../lib/units.js";
import { getModalSendiri } from "../reports/capital-service.js";
import { hasPokokSaving } from "../savings/service.js";
import { recordAudit } from "../audit-log/service.js";
import type {
  BmppHeadroomQueryInput,
  CreateLoanConfigInput,
  CreateLoanInput,
  ListLoansQueryInput,
  LoanPaymentInput,
  PreviewScheduleInput,
  UpdateLoanConfigInput
} from "./schema.js";

// ── Config ────────────────────────────────────────────────────────────────

/**
 * ANNUITY (plain BUNGA+KONVENSIONAL) only amortizes cleanly month-by-month —
 * a DAILY/WEEKLY frequency for it has no defined formula (D3/D8's schedule
 * spec only covers FLAT/HARIAN there). HARIAN and FLAT margin (SYARIAH or
 * MARGIN rateType) are real-day based and work at any frequency.
 */
function assertFrequencyMethodCompatible(input: {
  type: LoanType;
  rateType: RateType;
  installmentFrequency: InstallmentFrequency;
}): void {
  if (input.installmentFrequency === "MONTHLY") return;
  const isAnnuity = input.rateType !== "HARIAN" && input.type !== "SYARIAH" && input.rateType !== "MARGIN";
  if (isAnnuity) {
    throw validationError("Anuitas hanya tersedia untuk frekuensi cicilan bulanan");
  }
}

export async function listLoanConfigs(tenantId: string) {
  return db.loanConfig.findMany({ where: { tenantId, isActive: true }, orderBy: { createdAt: "asc" } });
}

export async function createLoanConfig(tenantId: string, data: CreateLoanConfigInput) {
  validateRegulatoryRate("LOAN", data.rate);
  assertFrequencyMethodCompatible(data);
  return db.loanConfig.create({
    data: {
      tenantId,
      name: data.name,
      type: data.type,
      rateType: data.rateType,
      rate: data.rate,
      maxTermMonths: data.maxTermMonths,
      installmentFrequency: data.installmentFrequency,
      maxInstallments: data.maxInstallments,
      isActive: true
    }
  });
}

export async function updateLoanConfig(tenantId: string, id: string, data: UpdateLoanConfigInput) {
  const config = await db.loanConfig.findFirst({ where: { id, tenantId } });
  if (!config) throw notFound("Konfigurasi pinjaman tidak ditemukan");
  if (data.rate !== undefined) validateRegulatoryRate("LOAN", data.rate);
  assertFrequencyMethodCompatible({
    type: data.type ?? config.type,
    rateType: data.rateType ?? config.rateType,
    installmentFrequency: data.installmentFrequency ?? config.installmentFrequency
  });
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
      payments: { include: { createdByUser: { select: { name: true } } }, orderBy: { paidAt: "desc" } },
      installments: { orderBy: { seq: "asc" } }
    }
  });
  if (!loan) throw notFound("Pinjaman tidak ditemukan");
  return loan;
}

export async function getLoanSchedule(tenantId: string, id: string) {
  const loan = await db.loan.findFirst({ where: { id, tenantId } });
  if (!loan) throw notFound("Pinjaman tidak ditemukan");
  return db.loanInstallment.findMany({ where: { loanId: id, tenantId }, orderBy: { seq: "asc" } });
}

/**
 * Simulates the schedule createLoan would produce for the given inputs,
 * without writing anything — the frontend's "pratinjau jadwal" (F2 plan).
 */
export async function previewSchedule(tenantId: string, data: PreviewScheduleInput) {
  const loanConfig = await db.loanConfig.findFirst({ where: { id: data.loanConfigId, tenantId, isActive: true } });
  if (!loanConfig) throw notFound("Jenis pembiayaan tidak ditemukan");

  const frequency = loanConfig.installmentFrequency;
  const count = frequency === "MONTHLY" ? data.termMonths : data.installmentCount;
  if (!count) {
    throw validationError(
      frequency === "MONTHLY"
        ? "Tenor (termMonths) wajib diisi untuk pinjaman bulanan"
        : "Jumlah cicilan (installmentCount) wajib diisi untuk pinjaman harian/mingguan"
    );
  }

  const productRate = Number(loanConfig.rate);
  const effectiveRate = data.rate ?? productRate;
  const disbursedAt = data.disbursedAt ? new Date(data.disbursedAt) : new Date();
  const termMonthsForLoan = frequency === "MONTHLY" ? count : Math.max(1, Math.ceil((frequency === "DAILY" ? count : count * 7) / 30));
  const termDays =
    loanConfig.rateType === "HARIAN"
      ? frequency === "MONTHLY"
        ? differenceInCalendarDays(addMonths(disbursedAt, termMonthsForLoan), disbursedAt)
        : frequency === "DAILY"
          ? count
          : count * 7
      : undefined;

  const calc = calculateLoan(data.principalAmount.toNumber(), effectiveRate, termMonthsForLoan, loanConfig.type, loanConfig.rateType, {
    termDays
  });

  const calendar = await loadOperatingCalendar(db, tenantId);
  const schedule = buildSchedule({
    principal: data.principalAmount,
    totalAmount: calc.totalAmount,
    frequency,
    count,
    disbursedAt,
    calendar,
    roundToRp500: frequency !== "MONTHLY"
  });

  return {
    totalAmount: calc.totalAmount.toString(),
    totalInterest: new Prisma.Decimal(calc.totalInterest).toString(),
    installments: schedule.map((s) => ({
      seq: s.seq,
      dueDate: s.dueDate.toISOString().slice(0, 10),
      principalDue: s.principalDue.toString(),
      interestDue: s.interestDue.toString()
    }))
  };
}

// ── BMPP (Permenkop UKM 8/2023 Pasal 44-45) ─────────────────────────────────

interface Bmpp {
  basis: "KONSOLIDASI" | "UNIT";
  unitId: string | null;
  modalSendiri: Prisma.Decimal;
  isRelatedParty: boolean;
  limitPct: number;
  limit: Prisma.Decimal;
  existingPrincipal: Prisma.Decimal;
}

/**
 * The member's BMPP position when lending from `unitId`. A single-unit
 * koperasi measures against its consolidated Modal Sendiri and all of the
 * member's ACTIVE loans; a KSU (more than one active unit) against the
 * lending unit's own Modal Sendiri — the USP's Modal Tetap in Pasal 1 angka
 * 18 terms — and only that unit's loans.
 */
async function computeBmpp(
  tenantId: string,
  member: { id: string; isPengurus: boolean; isPengawas: boolean },
  unitId: string
): Promise<Bmpp> {
  const activeUnits = await db.cooperativeUnit.count({ where: { tenantId, isActive: true } });
  const perUnit = activeUnits > 1;
  const [modalSendiri, activeLoans] = await Promise.all([
    getModalSendiri(tenantId, new Date(), perUnit ? unitId : undefined),
    db.loan.aggregate({
      where: { tenantId, memberId: member.id, status: "ACTIVE", ...(perUnit ? { unitId } : {}) },
      _sum: { principalAmount: true }
    })
  ]);
  const isRelatedParty = member.isPengurus || member.isPengawas;
  const limitPct = isRelatedParty
    ? REGULATORY_CAPS.RELATED_PARTY_LOAN_CONCENTRATION_PCT
    : REGULATORY_CAPS.NON_RELATED_PARTY_LOAN_CONCENTRATION_PCT;
  return {
    basis: perUnit ? "UNIT" : "KONSOLIDASI",
    unitId: perUnit ? unitId : null,
    modalSendiri: modalSendiri.total,
    isRelatedParty,
    limitPct,
    limit: modalSendiri.total.mul(limitPct).div(100),
    existingPrincipal: activeLoans._sum.principalAmount ?? new Prisma.Decimal(0)
  };
}

function serializeBmpp(bmpp: Bmpp): BmppHeadroom {
  const headroom = bmpp.limit.sub(bmpp.existingPrincipal);
  return {
    basis: bmpp.basis,
    unitId: bmpp.unitId,
    modalSendiri: bmpp.modalSendiri.toString(),
    isRelatedParty: bmpp.isRelatedParty,
    limitPct: bmpp.limitPct,
    limit: bmpp.limit.toString(),
    existingPrincipal: bmpp.existingPrincipal.toString(),
    headroom: (headroom.isNegative() ? new Prisma.Decimal(0) : headroom).toString()
  };
}

export async function getBmppHeadroom(tenantId: string, query: BmppHeadroomQueryInput): Promise<BmppHeadroom> {
  const member = await db.member.findFirst({ where: { id: query.memberId, tenantId } });
  if (!member) throw notFound("Anggota tidak ditemukan");
  const unitId = await resolveUnitId(tenantId, query.unitId);
  return serializeBmpp(await computeBmpp(tenantId, member, unitId));
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

  const unitId = await resolveUnitId(tenantId, data.unitId);
  const bmpp = await computeBmpp(tenantId, member, unitId);
  if (bmpp.isRelatedParty) {
    validateRelatedPartyLoanLimit({
      isRelatedParty: true,
      existingActivePrincipal: bmpp.existingPrincipal,
      newPrincipal: data.principalAmount,
      modalSendiri: bmpp.modalSendiri
    });
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

  // Pasal 45 for other members is a confirmable warning, not a block — and
  // only once there is a Modal Sendiri to judge against: a tenant without a
  // ledger (no accounting module) would otherwise be asked on every loan.
  const requested = new Prisma.Decimal(data.principalAmount);
  if (
    !bmpp.isRelatedParty &&
    !data.acknowledgeBmpp &&
    bmpp.modalSendiri.gt(0) &&
    bmpp.existingPrincipal.add(requested).gt(bmpp.limit)
  ) {
    return { bmppExceeded: true as const, bmpp: { ...serializeBmpp(bmpp), requested: requested.toString() } };
  }

  const loanConfig = await db.loanConfig.findFirst({
    where: { id: data.loanConfigId, tenantId, isActive: true }
  });
  if (!loanConfig) throw notFound("Jenis pembiayaan tidak ditemukan");

  const frequency = loanConfig.installmentFrequency;
  let count: number;
  let termMonthsForLoan: number;
  let termDaysOverride: number | undefined;

  if (frequency === "MONTHLY") {
    if (!data.termMonths) throw validationError("Tenor (termMonths) wajib diisi untuk pinjaman bulanan");
    if (data.termMonths > loanConfig.maxTermMonths) {
      throw new AppError(ErrorCode.TERM_EXCEEDS_MAX, `Tenor maksimal adalah ${loanConfig.maxTermMonths} bulan`);
    }
    count = data.termMonths;
    termMonthsForLoan = data.termMonths;
  } else {
    if (!data.installmentCount) {
      throw validationError("Jumlah cicilan (installmentCount) wajib diisi untuk pinjaman harian/mingguan");
    }
    if (loanConfig.maxInstallments && data.installmentCount > loanConfig.maxInstallments) {
      throw new AppError(ErrorCode.TERM_EXCEEDS_MAX, `Jumlah cicilan maksimal adalah ${loanConfig.maxInstallments}`);
    }
    count = data.installmentCount;
    termDaysOverride = frequency === "DAILY" ? count : count * 7;
    // Kept filled for backward-compat dashboards/reports (CLAUDE.md rule 2b
    // predates F2, but the field itself does too) — not authoritative for a
    // DAILY/WEEKLY loan, whose real schedule is LoanInstallment.
    termMonthsForLoan = Math.max(1, Math.ceil(termDaysOverride / 30));
  }

  // D3: an employee may override the product's rate, but must say why, and
  // the override is re-validated against the regulatory cap same as the
  // product rate was at config-creation time.
  const productRate = Number(loanConfig.rate);
  let effectiveRate = productRate;
  if (data.rate !== undefined && data.rate !== productRate) {
    if (!data.rateNote) {
      throw new AppError(ErrorCode.RATE_NOTE_REQUIRED, "Catatan wajib diisi saat mengubah rate dari rate produk");
    }
    validateRegulatoryRate("LOAN", data.rate);
    effectiveRate = data.rate;
  }

  const disbursedAt = data.disbursedAt ? new Date(data.disbursedAt) : new Date();

  // HARIAN uses the actual calendar days to maturity, not the termMonths*30
  // fallback calculateLoan uses when no disbursement date is known yet.
  const termDays =
    loanConfig.rateType === "HARIAN"
      ? frequency === "MONTHLY"
        ? differenceInCalendarDays(addMonths(disbursedAt, termMonthsForLoan), disbursedAt)
        : termDaysOverride
      : undefined;

  const calc = calculateLoan(
    data.principalAmount.toNumber(),
    effectiveRate,
    termMonthsForLoan,
    loanConfig.type,
    loanConfig.rateType,
    { termDays }
  );

  return db.$transaction(async (tx) => {
    const calendar = await loadOperatingCalendar(tx, tenantId);
    const schedule = buildSchedule({
      principal: data.principalAmount,
      totalAmount: calc.totalAmount,
      frequency,
      count,
      disbursedAt,
      calendar,
      roundToRp500: frequency !== "MONTHLY"
    });
    // count >= 1 is enforced above, so buildSchedule always returns at least one installment.
    const lastInstallment = schedule[schedule.length - 1]!;
    const firstInstallment = schedule[0]!;

    const loan = await tx.loan.create({
      data: {
        tenantId,
        unitId,
        memberId: data.memberId,
        loanConfigId: data.loanConfigId,
        principalAmount: data.principalAmount,
        totalAmount: calc.totalAmount,
        termMonths: termMonthsForLoan,
        monthlyPayment: calc.monthlyPayment,
        remainingAmount: calc.totalAmount,
        status: "ACTIVE",
        kolCategory: "LANCAR",
        disbursedAt,
        installmentFrequency: frequency,
        installmentCount: frequency === "MONTHLY" ? null : count,
        installmentAmount: firstInstallment.principalDue.plus(firstInstallment.interestDue),
        rate: effectiveRate,
        rateNote: data.rateNote ?? null,
        maturityDate: lastInstallment.dueDate
      },
      include: {
        loanConfig: true,
        member: { select: { memberId: true, fullName: true, accountNumber: true } }
      }
    });

    await tx.loanInstallment.createMany({
      data: schedule.map((s) => ({
        tenantId,
        loanId: loan.id,
        seq: s.seq,
        dueDate: s.dueDate,
        principalDue: s.principalDue,
        interestDue: s.interestDue
      }))
    });

    await postLoanDisbursement(tx, {
      tenantId,
      unitId: loan.unitId,
      loanId: loan.id,
      loanConfigId: data.loanConfigId,
      amount: data.principalAmount,
      entryDate: disbursedAt,
      description: "Pencairan pinjaman"
    });

    await recordAudit(tx, {
      action: "loan.create",
      entityType: "Loan",
      entityId: loan.id,
      after: {
        memberId: loan.memberId,
        principalAmount: loan.principalAmount,
        termMonths: loan.termMonths,
        rate: loan.rate,
        rateNote: loan.rateNote
      }
    });

    return loan;
  });
}

export async function recordLoanPayment(
  tenantId: string,
  loanId: string,
  data: LoanPaymentInput,
  createdBy: string,
  /** Recorded by a Kolektor (koperasi pasar F4) — see modules/collections/service.ts. */
  collector?: { batchId: string }
) {
  const result = await db.$transaction(async (tx) => {
    const loan = await tx.loan.findUnique({
      where: { id: loanId },
      include: { installments: { orderBy: { seq: "asc" } } }
    });
    if (!loan || loan.tenantId !== tenantId) throw notFound("Pinjaman tidak ditemukan");
    if (loan.status !== "ACTIVE") {
      throw new AppError(ErrorCode.LOAN_NOT_ACTIVE, "Pinjaman tidak dalam status aktif");
    }

    const amount = new Prisma.Decimal(data.amount);
    if (amount.gt(loan.remainingAmount)) {
      throw new AppError(ErrorCode.PAYMENT_EXCEEDS_REMAINING, "Nominal bayar melebihi sisa pinjaman");
    }

    const paidAt = new Date(data.paidAt);

    const payment = await tx.loanPayment.create({
      data: {
        loanId,
        tenantId,
        amount: data.amount,
        penalty: data.penalty,
        paidAt,
        note: data.note,
        createdBy,
        collectionBatchId: collector?.batchId ?? null
      }
    });

    const { principal, interest, allocations } = await allocatePayment(tx, {
      tenantId,
      loan,
      paymentId: payment.id,
      amount,
      paidAt
    });

    await postLoanPayment(tx, {
      tenantId,
      unitId: loan.unitId,
      loanPaymentId: payment.id,
      loanConfigId: loan.loanConfigId,
      principalAmount: principal,
      interestAmount: interest,
      penaltyAmount: data.penalty,
      entryDate: paidAt,
      description: "Pembayaran cicilan pinjaman",
      viaCollector: !!collector
    });

    const newRemaining = Prisma.Decimal.max(0, loan.remainingAmount.sub(data.amount));
    const newStatus = newRemaining.lte(0) ? ("COMPLETED" as const) : ("ACTIVE" as const);

    await tx.loan.update({
      where: { id: loanId, tenantId },
      data: { remainingAmount: newRemaining, status: newStatus }
    });

    await recordAudit(tx, {
      action: "loan.payment",
      entityType: "Loan",
      entityId: loanId,
      before: { remainingAmount: loan.remainingAmount, status: loan.status },
      after: { amount: data.amount, remainingAmount: newRemaining, status: newStatus }
    });

    return { loanId, newRemaining: newRemaining.toString(), status: newStatus, allocations };
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
