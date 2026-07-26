import { LoanStatus, KOLCategory } from '@siskop/shared';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError, Errors } from '../../lib/errors';
import { calculateLoan } from '../../lib/loan-calc';
import { recalculateKOL } from '../../lib/kol';
import { postLoanDisbursement, postLoanPayment, splitPrincipalAndInterest } from '../../lib/journal';
import { savingsService } from '../savings/savings.service';
import {
  CreateLoanConfigInput,
  UpdateLoanConfigInput,
  CreateLoanInput,
  LoanPaymentInput,
  LoanQuery,
} from './loans.schema';

export class LoansService {
  // ── Config ──────────────────────────────────────────────────────────────────

  async listConfigs(tenantId: string) {
    return prisma.loanConfig.findMany({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createConfig(tenantId: string, data: CreateLoanConfigInput) {
    return prisma.loanConfig.create({
      data: {
        tenantId,
        name: data.name,
        type: data.type as unknown as import('@prisma/client').LoanType,
        rateType: data.rateType as unknown as import('@prisma/client').RateType,
        rate: data.rate,
        maxTermMonths: data.maxTermMonths,
        isActive: true,
      },
    });
  }

  async updateConfig(tenantId: string, id: string, data: UpdateLoanConfigInput) {
    const config = await prisma.loanConfig.findFirst({ where: { id, tenantId } });
    if (!config) throw new AppError('CONFIG_NOT_FOUND', 'Konfigurasi pinjaman tidak ditemukan', 404);
    return prisma.loanConfig.update({ where: { id }, data });
  }

  // ── Loans ────────────────────────────────────────────────────────────────────

  async list(tenantId: string, query: LoanQuery) {
    const { page, limit, search, status, kolCategory, memberId, loanConfigId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.LoanWhereInput = {
      tenantId,
      ...(status ? { status: status as unknown as import('@prisma/client').LoanStatus } : {}),
      ...(kolCategory ? { kolCategory: kolCategory as unknown as import('@prisma/client').KOLCategory } : {}),
      ...(memberId ? { memberId } : {}),
      ...(loanConfigId ? { loanConfigId } : {}),
      ...(search
        ? {
            OR: [
              { member: { fullName: { contains: search, mode: 'insensitive' } } },
              { member: { memberId: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.loan.findMany({
        where,
        skip,
        take: limit,
        include: {
          member: { select: { memberId: true, fullName: true, accountNumber: true } },
          loanConfig: { select: { name: true, type: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.loan.count({ where }),
    ]);

    return { items, meta: { page, limit, total } };
  }

  async findById(tenantId: string, id: string) {
    const loan = await prisma.loan.findFirst({
      where: { id, tenantId },
      include: {
        member: { select: { memberId: true, fullName: true, accountNumber: true } },
        loanConfig: true,
        payments: { orderBy: { paidAt: 'desc' } },
      },
    });
    if (!loan) throw Errors.LOAN_NOT_FOUND();
    return loan;
  }

  async create(tenantId: string, data: CreateLoanInput, createdBy: string) {
    const member = await prisma.member.findFirst({
      where: { id: data.memberId, tenantId, isActive: true },
    });
    if (!member) throw Errors.MEMBER_NOT_FOUND();

    const hasPokokSaving = await savingsService.hasPokokSaving(tenantId, data.memberId);
    if (!hasPokokSaving) throw Errors.MEMBER_HAS_NO_POKOK_SAVING();

    if (!data.force) {
      const existingLoan = await prisma.loan.findFirst({
        where: {
          tenantId,
          memberId: data.memberId,
          status: { in: ['ACTIVE', 'PENDING'] as import('@prisma/client').LoanStatus[] },
        },
      });
      if (existingLoan) {
        return {
          hasExistingLoan: true,
          existingLoan: {
            id: existingLoan.id,
            principalAmount: existingLoan.principalAmount.toString(),
            remainingAmount: existingLoan.remainingAmount.toString(),
          },
        };
      }
    }

    const loanConfig = await prisma.loanConfig.findFirst({
      where: { id: data.loanConfigId, tenantId, isActive: true },
    });
    if (!loanConfig) {
      throw new AppError('LOAN_CONFIG_NOT_FOUND', 'Jenis pembiayaan tidak ditemukan', 404);
    }

    if (data.termMonths > loanConfig.maxTermMonths) {
      throw new AppError(
        'TERM_EXCEEDS_MAX',
        `Tenor maksimal adalah ${loanConfig.maxTermMonths} bulan`,
        400
      );
    }

    const calc = calculateLoan(
      data.principalAmount,
      Number(loanConfig.rate),
      data.termMonths,
      loanConfig.type as unknown as import('@siskop/shared').LoanType,
      loanConfig.rateType as unknown as import('@siskop/shared').RateType
    );

    const disbursedAt = data.disbursedAt ? new Date(data.disbursedAt) : new Date();

    void createdBy;

    return prisma.$transaction(async (tx) => {
      const loan = await tx.loan.create({
        data: {
          tenantId,
          memberId: data.memberId,
          loanConfigId: data.loanConfigId,
          principalAmount: data.principalAmount,
          totalAmount: calc.totalAmount,
          termMonths: data.termMonths,
          monthlyPayment: calc.monthlyPayment,
          remainingAmount: calc.totalAmount,
          status: LoanStatus.ACTIVE as unknown as import('@prisma/client').LoanStatus,
          kolCategory: KOLCategory.LANCAR as unknown as import('@prisma/client').KOLCategory,
          disbursedAt,
        },
        include: {
          loanConfig: true,
          member: { select: { memberId: true, fullName: true, accountNumber: true } },
        },
      });

      await postLoanDisbursement(tx, {
        tenantId,
        loanId: loan.id,
        loanConfigId: data.loanConfigId,
        amount: data.principalAmount,
        entryDate: disbursedAt,
        description: 'Pencairan pinjaman',
      });

      return loan;
    });
  }

  async recordPayment(
    tenantId: string,
    loanId: string,
    data: LoanPaymentInput,
    createdBy: string
  ) {
    const result = await prisma.$transaction(async (tx) => {
      const loan = await tx.loan.findUnique({ where: { id: loanId } });
      if (!loan || loan.tenantId !== tenantId) throw Errors.LOAN_NOT_FOUND();
      if (loan.status !== 'ACTIVE') {
        throw new AppError('LOAN_NOT_ACTIVE', 'Pinjaman tidak dalam status aktif', 400);
      }

      const paidAt = new Date(data.paidAt);

      const payment = await tx.loanPayment.create({
        data: {
          loanId,
          tenantId,
          amount: data.amount,
          penalty: data.penalty ?? 0,
          paidAt,
          dueDate: new Date(data.dueDate),
          note: data.note,
          createdBy,
        },
      });

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
        penaltyAmount: data.penalty ?? 0,
        entryDate: paidAt,
        description: 'Pembayaran cicilan pinjaman',
      });

      const newRemaining = Math.max(0, Number(loan.remainingAmount) - data.amount);
      const newStatus =
        newRemaining <= 0
          ? (LoanStatus.COMPLETED as unknown as import('@prisma/client').LoanStatus)
          : (LoanStatus.ACTIVE as unknown as import('@prisma/client').LoanStatus);

      await tx.loan.update({
        where: { id: loanId },
        data: { remainingAmount: newRemaining, status: newStatus },
      });

      return { loanId, newRemaining, status: newStatus };
    });

    const newKOL = await recalculateKOL(loanId);
    return { ...result, kolCategory: newKOL };
  }

  async getOverdue(tenantId: string) {
    const loans = await prisma.loan.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        kolCategory: { not: 'LANCAR' },
      },
      include: {
        member: { select: { memberId: true, fullName: true, accountNumber: true } },
        loanConfig: { select: { name: true, type: true } },
        payments: { orderBy: { paidAt: 'desc' }, take: 1 },
      },
      orderBy: [{ kolCategory: 'desc' }, { updatedAt: 'asc' }],
    });

    return loans.map(({ payments, ...loan }) => ({
      ...loan,
      lastPaymentAt: payments[0]?.paidAt ?? null,
    }));
  }
}

export const loansService = new LoansService();
