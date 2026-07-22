import prisma from '../../lib/prisma';
import { Errors } from '../../lib/errors';
import { UpsertShuDistributionInput } from './shu-distribution.schema';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class ShuDistributionService {
  async get(tenantId: string) {
    return prisma.shuDistributionConfig.findUnique({ where: { tenantId } });
  }

  async upsert(tenantId: string, data: UpsertShuDistributionInput) {
    const sum = round2(
      data.jasaSimpananPercent + data.jasaPinjamanPercent + data.cadanganPercent + data.lainnyaPercent
    );
    if (sum !== 100) {
      throw Errors.SHU_DISTRIBUTION_PERCENT_INVALID(
        `Jumlah keempat persentase harus tepat 100% (saat ini ${sum}%)`
      );
    }

    return prisma.shuDistributionConfig.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: { ...data },
    });
  }
}

export const shuDistributionService = new ShuDistributionService();
