import prisma from './prisma';

/**
 * Generate Member ID: KOP-{TENANTSLUG}-{YYYYMM}-{4-digit-sequence}
 * Contoh: KOP-KOPSEJAHTERA-202606-0001
 */
export async function generateMemberId(tenantId: string, tenantSlug: string): Promise<string> {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `KOP-${tenantSlug.toUpperCase()}-${yearMonth}-`;

  const count = await prisma.member.count({
    where: {
      tenantId,
      memberId: { startsWith: prefix },
    },
  });

  const sequence = String(count + 1).padStart(4, '0');
  return `${prefix}${sequence}`;
}

/**
 * Generate Account Number: ACC-{10-digit-random-numeric}
 * Contoh: ACC-3847291045
 */
export async function generateAccountNumber(): Promise<string> {
  let accountNumber: string;
  let exists = true;

  while (exists) {
    const random = Math.floor(Math.random() * 9_000_000_000) + 1_000_000_000;
    accountNumber = `ACC-${random}`;
    const found = await prisma.member.findUnique({ where: { accountNumber } });
    exists = !!found;
  }

  return accountNumber!;
}
