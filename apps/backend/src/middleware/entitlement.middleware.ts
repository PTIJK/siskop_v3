import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { Errors } from '../lib/errors';

/** Gate creating a new custom SavingConfig against the tenant's package.maxSavingConfigs cap. */
export async function requireSavingConfigQuota(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const maxSavingConfigs = req.tenant.package?.maxSavingConfigs;
    if (maxSavingConfigs !== null && maxSavingConfigs !== undefined) {
      const count = await prisma.savingConfig.count({
        where: { tenantId: req.tenant.id, isDefault: false },
      });
      if (count >= maxSavingConfigs) {
        throw Errors.PACKAGE_LIMIT_EXCEEDED(
          `Batas ${maxSavingConfigs} simpanan custom pada paket Anda sudah tercapai`
        );
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

/** Gate any WhitelabelConfig write against the tenant's package.whitelabelEnabled flag. */
export function requireWhitelabelEntitlement(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.tenant.package?.whitelabelEnabled) {
    next(Errors.FEATURE_NOT_ENTITLED('Paket langganan Anda tidak mengaktifkan fitur whitelabel'));
    return;
  }
  next();
}
