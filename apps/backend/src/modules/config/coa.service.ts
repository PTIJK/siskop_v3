import { Prisma } from '@prisma/client';
import prisma from '../../lib/prisma';
import { AppError, Errors } from '../../lib/errors';
import {
  CATEGORY_NORMAL_BALANCE,
  CATEGORY_PREFIX,
  DEFAULT_COA_TEMPLATE,
  EXPECTED_MAPPING_SHAPE,
  LOAN_CONFIG_KINDS,
  SAVING_CONFIG_KINDS,
} from './coa.template';
import {
  AccountQuery,
  CreateAccountInput,
  UpdateAccountInput,
  UpsertAccountMappingInput,
} from './coa.schema';

function assertCodeMatchesCategory(code: string, category: string): void {
  const prefix = CATEGORY_PREFIX[category as keyof typeof CATEGORY_PREFIX];
  if (!code.startsWith(prefix)) {
    throw Errors.ACCOUNT_CODE_INVALID_FORMAT(
      `Kode akun untuk kategori ${category} harus diawali "${prefix}"`
    );
  }
}

export class CoaService {
  // ── Accounts ──────────────────────────────────────────────────────────────────

  async listAccounts(tenantId: string, query: AccountQuery) {
    const { page, limit, search, category } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AccountWhereInput = {
      tenantId,
      ...(category ? { category: category as unknown as import('@prisma/client').AccountCategory } : {}),
      ...(search
        ? {
            OR: [
              { code: { contains: search, mode: 'insensitive' } },
              { name: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.account.findMany({
        where,
        skip,
        take: limit,
        orderBy: { code: 'asc' },
      }),
      prisma.account.count({ where }),
    ]);

    return { items, meta: { page, limit, total } };
  }

  async createAccount(tenantId: string, data: CreateAccountInput) {
    assertCodeMatchesCategory(data.code, data.category);

    const dup = await prisma.account.findUnique({
      where: { tenantId_code: { tenantId, code: data.code } },
    });
    if (dup) throw Errors.ACCOUNT_CODE_DUPLICATE();

    if (data.parentId) {
      const parent = await prisma.account.findFirst({ where: { id: data.parentId, tenantId } });
      if (!parent) throw Errors.ACCOUNT_NOT_FOUND();
    }

    return prisma.account.create({
      data: {
        tenantId,
        code: data.code,
        name: data.name,
        category: data.category as unknown as import('@prisma/client').AccountCategory,
        normalBalance: CATEGORY_NORMAL_BALANCE[data.category] as unknown as import('@prisma/client').NormalBalance,
        parentId: data.parentId ?? null,
        isHeader: data.isHeader ?? false,
        isDefault: false,
        isActive: true,
      },
    });
  }

  async updateAccount(tenantId: string, id: string, data: UpdateAccountInput) {
    const account = await prisma.account.findFirst({ where: { id, tenantId } });
    if (!account) throw Errors.ACCOUNT_NOT_FOUND();

    if (data.isActive === false) {
      await this.assertAccountNotInUse(tenantId, id, account.isDefault);
    }

    return prisma.account.update({ where: { id }, data });
  }

  async deactivateAccount(tenantId: string, id: string): Promise<void> {
    const account = await prisma.account.findFirst({ where: { id, tenantId } });
    if (!account) throw Errors.ACCOUNT_NOT_FOUND();

    await this.assertAccountNotInUse(tenantId, id, account.isDefault);

    await prisma.account.update({ where: { id }, data: { isActive: false } });
  }

  private async assertAccountNotInUse(
    tenantId: string,
    accountId: string,
    isDefault: boolean
  ): Promise<void> {
    if (isDefault) {
      throw Errors.ACCOUNT_IN_USE('Akun bawaan (default) tidak dapat dihapus atau dinonaktifkan');
    }

    const mappingCount = await prisma.accountMapping.count({
      where: {
        tenantId,
        OR: [{ debitAccountId: accountId }, { creditAccountId: accountId }],
      },
    });
    if (mappingCount > 0) {
      throw Errors.ACCOUNT_IN_USE(
        'Akun masih digunakan pada pemetaan transaksi dan tidak dapat dihapus atau dinonaktifkan'
      );
    }
  }

  async seedDefaultTemplate(tenantId: string) {
    const existingCount = await prisma.account.count({ where: { tenantId } });
    if (existingCount > 0) {
      throw new AppError(
        'COA_ALREADY_SEEDED',
        'Koperasi ini sudah memiliki daftar akun — template standar hanya dapat diisi pada daftar kosong',
        409
      );
    }

    await prisma.$transaction(async (tx) => {
      for (const item of DEFAULT_COA_TEMPLATE) {
        await tx.account.create({
          data: {
            tenantId,
            code: item.code,
            name: item.name,
            category: item.category as unknown as import('@prisma/client').AccountCategory,
            normalBalance: CATEGORY_NORMAL_BALANCE[item.category] as unknown as import('@prisma/client').NormalBalance,
            isHeader: item.isHeader ?? false,
            isDefault: true,
            isActive: true,
          },
        });
      }
    });

    return prisma.account.findMany({ where: { tenantId }, orderBy: { code: 'asc' } });
  }

  // ── Mappings ──────────────────────────────────────────────────────────────────

  async listMappings(tenantId: string) {
    const mappings = await prisma.accountMapping.findMany({
      where: { tenantId },
      include: { debitAccount: true, creditAccount: true },
      orderBy: { createdAt: 'asc' },
    });

    const savingConfigIds = mappings
      .filter((m) => m.sourceType === 'SAVING_CONFIG' && m.sourceId)
      .map((m) => m.sourceId as string);
    const loanConfigIds = mappings
      .filter((m) => m.sourceType === 'LOAN_CONFIG' && m.sourceId)
      .map((m) => m.sourceId as string);

    const [savingConfigs, loanConfigs] = await Promise.all([
      savingConfigIds.length
        ? prisma.savingConfig.findMany({ where: { id: { in: savingConfigIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
      loanConfigIds.length
        ? prisma.loanConfig.findMany({ where: { id: { in: loanConfigIds } }, select: { id: true, name: true } })
        : Promise.resolve([]),
    ]);

    const savingConfigNameById = new Map(savingConfigs.map((c) => [c.id, c.name]));
    const loanConfigNameById = new Map(loanConfigs.map((c) => [c.id, c.name]));

    return mappings.map((m) => ({
      ...m,
      sourceName:
        m.sourceType === 'SAVING_CONFIG'
          ? savingConfigNameById.get(m.sourceId ?? '') ?? null
          : m.sourceType === 'LOAN_CONFIG'
            ? loanConfigNameById.get(m.sourceId ?? '') ?? null
            : 'Sistem',
    }));
  }

  async upsertMapping(tenantId: string, data: UpsertAccountMappingInput) {
    if (data.sourceType === 'SAVING_CONFIG') {
      if (!SAVING_CONFIG_KINDS.includes(data.transactionKind as (typeof SAVING_CONFIG_KINDS)[number])) {
        throw new AppError(
          'VALIDATION_ERROR',
          `transactionKind ${data.transactionKind} tidak berlaku untuk SAVING_CONFIG`,
          422
        );
      }
      const config = await prisma.savingConfig.findFirst({ where: { id: data.sourceId ?? '', tenantId } });
      if (!config) throw new AppError('CONFIG_NOT_FOUND', 'Konfigurasi simpanan tidak ditemukan', 404);
    } else if (data.sourceType === 'LOAN_CONFIG') {
      if (!LOAN_CONFIG_KINDS.includes(data.transactionKind as (typeof LOAN_CONFIG_KINDS)[number])) {
        throw new AppError(
          'VALIDATION_ERROR',
          `transactionKind ${data.transactionKind} tidak berlaku untuk LOAN_CONFIG`,
          422
        );
      }
      const config = await prisma.loanConfig.findFirst({ where: { id: data.sourceId ?? '', tenantId } });
      if (!config) throw new AppError('CONFIG_NOT_FOUND', 'Konfigurasi pinjaman tidak ditemukan', 404);
    }

    const [debitAccount, creditAccount] = await Promise.all([
      prisma.account.findFirst({ where: { id: data.debitAccountId, tenantId } }),
      prisma.account.findFirst({ where: { id: data.creditAccountId, tenantId } }),
    ]);
    if (!debitAccount || !creditAccount) throw Errors.ACCOUNT_NOT_FOUND();

    const expectedShape = EXPECTED_MAPPING_SHAPE[data.transactionKind];
    if (expectedShape) {
      if (!expectedShape.debit.includes(debitAccount.category as unknown as import('@siskop/shared').AccountCategory)) {
        throw Errors.MAPPING_ACCOUNT_CATEGORY_MISMATCH(
          `Akun debit untuk ${data.transactionKind} harus berkategori ${expectedShape.debit.join('/')}`
        );
      }
      if (!expectedShape.credit.includes(creditAccount.category as unknown as import('@siskop/shared').AccountCategory)) {
        throw Errors.MAPPING_ACCOUNT_CATEGORY_MISMATCH(
          `Akun kredit untuk ${data.transactionKind} harus berkategori ${expectedShape.credit.join('/')}`
        );
      }
    }

    const sourceType = data.sourceType as unknown as import('@prisma/client').MappingSourceType;
    const transactionKind = data.transactionKind as unknown as import('@prisma/client').MappingTransactionKind;

    // Postgres treats NULL as distinct in unique constraints, so the (tenantId, sourceType,
    // sourceId, transactionKind) compound key can't reliably upsert a null sourceId (SYSTEM
    // mappings) — Prisma's generated compound-unique input reflects this by requiring a
    // non-null sourceId. Look the SYSTEM row up manually instead.
    if (data.sourceType === 'SYSTEM') {
      const existing = await prisma.accountMapping.findFirst({
        where: { tenantId, sourceType, sourceId: null, transactionKind },
      });
      if (existing) {
        return prisma.accountMapping.update({
          where: { id: existing.id },
          data: { debitAccountId: data.debitAccountId, creditAccountId: data.creditAccountId },
          include: { debitAccount: true, creditAccount: true },
        });
      }
      return prisma.accountMapping.create({
        data: {
          tenantId,
          sourceType,
          sourceId: null,
          transactionKind,
          debitAccountId: data.debitAccountId,
          creditAccountId: data.creditAccountId,
        },
        include: { debitAccount: true, creditAccount: true },
      });
    }

    const sourceId = data.sourceId as string;

    return prisma.accountMapping.upsert({
      where: {
        tenantId_sourceType_sourceId_transactionKind: {
          tenantId,
          sourceType,
          sourceId,
          transactionKind,
        },
      },
      create: {
        tenantId,
        sourceType,
        sourceId,
        transactionKind,
        debitAccountId: data.debitAccountId,
        creditAccountId: data.creditAccountId,
      },
      update: {
        debitAccountId: data.debitAccountId,
        creditAccountId: data.creditAccountId,
      },
      include: { debitAccount: true, creditAccount: true },
    });
  }

  async getCompleteness(tenantId: string) {
    const [savingConfigs, loanConfigs, mappings] = await Promise.all([
      prisma.savingConfig.findMany({ where: { tenantId, isActive: true }, select: { id: true } }),
      prisma.loanConfig.findMany({ where: { tenantId, isActive: true }, select: { id: true } }),
      prisma.accountMapping.findMany({
        where: { tenantId, sourceType: { in: ['SAVING_CONFIG', 'LOAN_CONFIG'] } },
        select: { sourceType: true, sourceId: true, transactionKind: true },
      }),
    ]);

    const mappedSet = new Set(mappings.map((m) => `${m.sourceType}:${m.sourceId}:${m.transactionKind}`));

    let total = 0;
    let mapped = 0;
    for (const config of savingConfigs) {
      for (const kind of SAVING_CONFIG_KINDS) {
        total += 1;
        if (mappedSet.has(`SAVING_CONFIG:${config.id}:${kind}`)) mapped += 1;
      }
    }
    for (const config of loanConfigs) {
      for (const kind of LOAN_CONFIG_KINDS) {
        total += 1;
        if (mappedSet.has(`LOAN_CONFIG:${config.id}:${kind}`)) mapped += 1;
      }
    }

    return {
      total,
      mapped,
      unmapped: total - mapped,
      percentage: total === 0 ? 0 : Math.round((mapped / total) * 100),
    };
  }
}

export const coaService = new CoaService();
