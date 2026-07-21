import prisma from './prisma';
import { Errors } from './errors';
import { TenantWithPackage } from '../middleware/tenant.middleware';

/**
 * Custom (non-default) SavingConfig ids that are frozen because the tenant's
 * current package caps maxSavingConfigs below what already exists. Oldest
 * custom configs stay active; the most recently created ones freeze first
 * (per Design Spec — Paket Langganan §6).
 */
export async function getFrozenSavingConfigIds(tenant: TenantWithPackage): Promise<Set<string>> {
  const maxSavingConfigs = tenant.package?.maxSavingConfigs;
  if (maxSavingConfigs === null || maxSavingConfigs === undefined) return new Set();

  const customConfigs = await prisma.savingConfig.findMany({
    where: { tenantId: tenant.id, isDefault: false },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  return new Set(customConfigs.slice(maxSavingConfigs).map((c) => c.id));
}

export async function assertSavingConfigNotFrozen(
  tenant: TenantWithPackage,
  savingConfigId: string
): Promise<void> {
  const frozen = await getFrozenSavingConfigIds(tenant);
  if (frozen.has(savingConfigId)) {
    throw Errors.PACKAGE_LIMIT_EXCEEDED(
      'Konfigurasi simpanan ini dibekukan karena melebihi batas paket langganan saat ini'
    );
  }
}
