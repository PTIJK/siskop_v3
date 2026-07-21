import { SavingType, TransactionType } from '@siskop/shared';
import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError, Errors } from '../../lib/errors';
import { assertSavingConfigNotFrozen } from '../../lib/entitlement';
import { TenantWithPackage } from '../../middleware/tenant.middleware';
import {
  CreateSavingConfigInput,
  UpdateSavingConfigInput,
  CreateSavingInput,
  TransactionInput,
  SavingQuery,
} from './savings.schema';

export class SavingsService {
  // ── Config ──────────────────────────────────────────────────────────────────

  async listConfigs(tenantId: string) {
    return prisma.savingConfig.findMany({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createConfig(tenantId: string, data: CreateSavingConfigInput) {
    return prisma.savingConfig.create({
      data: {
        tenantId,
        name: data.name,
        type: data.type as unknown as import('@prisma/client').SavingType,
        rateType: data.rateType as unknown as import('@prisma/client').RateType,
        rate: data.rate,
        periodUnit: data.periodUnit,
        isDefault: false,
        isActive: true,
      },
    });
  }

  async updateConfig(tenant: TenantWithPackage, id: string, data: UpdateSavingConfigInput) {
    const config = await prisma.savingConfig.findFirst({ where: { id, tenantId: tenant.id } });
    if (!config) throw new AppError('CONFIG_NOT_FOUND', 'Konfigurasi simpanan tidak ditemukan', 404);
    if (!config.isDefault) await assertSavingConfigNotFrozen(tenant, id);
    return prisma.savingConfig.update({ where: { id }, data });
  }

  // ── Saving accounts ─────────────────────────────────────────────────────────

  async list(tenantId: string, query: SavingQuery) {
    const { page, limit, search, memberId } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.SavingWhereInput = {
      tenantId,
      isActive: true,
      ...(memberId ? { memberId } : {}),
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
      prisma.saving.findMany({
        where,
        skip,
        take: limit,
        include: {
          member: { select: { memberId: true, fullName: true, accountNumber: true } },
          savingConfig: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.saving.count({ where }),
    ]);

    return { items, meta: { page, limit, total } };
  }

  async findById(tenantId: string, id: string) {
    const saving = await prisma.saving.findFirst({
      where: { id, tenantId },
      include: {
        member: { select: { memberId: true, fullName: true, accountNumber: true } },
        savingConfig: true,
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!saving) throw new AppError('SAVING_NOT_FOUND', 'Rekening simpanan tidak ditemukan', 404);
    return saving;
  }

  async create(tenantId: string, data: CreateSavingInput, createdBy: string) {
    const member = await prisma.member.findFirst({
      where: { id: data.memberId, tenantId, isActive: true },
    });
    if (!member) throw Errors.MEMBER_NOT_FOUND();

    const config = await prisma.savingConfig.findFirst({
      where: { id: data.savingConfigId, tenantId, isActive: true },
    });
    if (!config) throw new AppError('CONFIG_NOT_FOUND', 'Konfigurasi simpanan tidak ditemukan', 404);

    return prisma.$transaction(async (tx) => {
      const saving = await tx.saving.create({
        data: {
          tenantId,
          memberId: data.memberId,
          savingConfigId: data.savingConfigId,
          balance: data.initialDeposit,
          isActive: true,
        },
      });

      if (data.initialDeposit > 0) {
        await tx.savingTransaction.create({
          data: {
            savingId: saving.id,
            tenantId,
            type: TransactionType.DEPOSIT as unknown as import('@prisma/client').TransactionType,
            amount: data.initialDeposit,
            note: 'Setoran awal',
            createdBy,
          },
        });
      }

      return saving;
    });
  }

  async listTransactions(tenantId: string, savingId: string, page: number, limit: number) {
    const saving = await prisma.saving.findFirst({ where: { id: savingId, tenantId } });
    if (!saving) throw new AppError('SAVING_NOT_FOUND', 'Rekening simpanan tidak ditemukan', 404);

    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      prisma.savingTransaction.findMany({
        where: { savingId, tenantId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.savingTransaction.count({ where: { savingId, tenantId } }),
    ]);

    return { items, meta: { page, limit, total } };
  }

  async deposit(
    tenant: TenantWithPackage,
    savingId: string,
    data: TransactionInput,
    createdBy: string
  ) {
    const tenantId = tenant.id;
    return prisma.$transaction(async (tx) => {
      const saving = await tx.saving.findUnique({ where: { id: savingId } });
      if (!saving || saving.tenantId !== tenantId) {
        throw new AppError('SAVING_NOT_FOUND', 'Rekening simpanan tidak ditemukan', 404);
      }

      await assertSavingConfigNotFrozen(tenant, saving.savingConfigId);

      await tx.saving.update({
        where: { id: savingId },
        data: { balance: { increment: data.amount } },
      });

      return tx.savingTransaction.create({
        data: {
          savingId,
          tenantId,
          type: TransactionType.DEPOSIT as unknown as import('@prisma/client').TransactionType,
          amount: data.amount,
          note: data.note,
          createdBy,
        },
      });
    });
  }

  async withdraw(
    tenant: TenantWithPackage,
    savingId: string,
    data: TransactionInput,
    createdBy: string
  ) {
    const tenantId = tenant.id;
    return prisma.$transaction(async (tx) => {
      const saving = await tx.saving.findUnique({
        where: { id: savingId },
        include: { savingConfig: true },
      });
      if (!saving || saving.tenantId !== tenantId) {
        throw new AppError('SAVING_NOT_FOUND', 'Rekening simpanan tidak ditemukan', 404);
      }

      await assertSavingConfigNotFrozen(tenant, saving.savingConfigId);

      if (Number(saving.balance) < data.amount) throw Errors.INSUFFICIENT_BALANCE();

      if (saving.savingConfig.type === (SavingType.POKOK as unknown as import('@prisma/client').SavingType)) {
        const activeLoan = await tx.loan.findFirst({
          where: { tenantId, memberId: saving.memberId, status: 'ACTIVE' },
        });
        if (activeLoan) {
          throw new AppError(
            'CANNOT_WITHDRAW_POKOK',
            'Simpanan pokok tidak dapat ditarik selama masih ada pinjaman aktif',
            400
          );
        }
      }

      await tx.saving.update({
        where: { id: savingId },
        data: { balance: { decrement: data.amount } },
      });

      return tx.savingTransaction.create({
        data: {
          savingId,
          tenantId,
          type: TransactionType.WITHDRAWAL as unknown as import('@prisma/client').TransactionType,
          amount: data.amount,
          note: data.note,
          createdBy,
        },
      });
    });
  }

  async getMemberSavingsByType(tenantId: string, memberId: string, type: SavingType) {
    return prisma.saving.findMany({
      where: {
        tenantId,
        memberId,
        isActive: true,
        savingConfig: { type: type as unknown as import('@prisma/client').SavingType },
      },
      include: { savingConfig: true },
    });
  }

  async hasPokokSaving(tenantId: string, memberId: string): Promise<boolean> {
    const count = await prisma.saving.count({
      where: {
        tenantId,
        memberId,
        isActive: true,
        savingConfig: { type: 'POKOK' },
      },
    });
    return count > 0;
  }
}

export const savingsService = new SavingsService();
