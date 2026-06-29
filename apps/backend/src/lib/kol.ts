import { KOLCategory } from '@siskop/shared';
import prisma from './prisma';
import { differenceInDays } from 'date-fns';

export function getKOLCategory(daysOverdue: number): KOLCategory {
  if (daysOverdue <= 30) return KOLCategory.LANCAR;
  if (daysOverdue <= 90) return KOLCategory.DALAM_PERHATIAN;
  if (daysOverdue <= 120) return KOLCategory.KURANG_LANCAR;
  if (daysOverdue <= 180) return KOLCategory.DIRAGUKAN;
  return KOLCategory.MACET;
}

export async function recalculateKOL(loanId: string): Promise<KOLCategory> {
  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: {
      payments: {
        orderBy: { dueDate: 'asc' },
      },
    },
  });

  if (!loan || loan.status !== 'ACTIVE') return KOLCategory.LANCAR;

  const today = new Date();
  const payments = loan.payments;
  const disbursed = loan.disbursedAt || loan.createdAt;
  let maxDaysOverdue = 0;

  for (let i = 1; i <= loan.termMonths; i++) {
    const dueDate = new Date(disbursed);
    dueDate.setMonth(dueDate.getMonth() + i);

    if (dueDate > today) break;

    const payment = payments.find(
      (p) =>
        p.dueDate.getFullYear() === dueDate.getFullYear() &&
        p.dueDate.getMonth() === dueDate.getMonth()
    );

    if (!payment) {
      const days = differenceInDays(today, dueDate);
      maxDaysOverdue = Math.max(maxDaysOverdue, days);
    }
  }

  const newCategory = getKOLCategory(maxDaysOverdue);

  await prisma.loan.update({
    where: { id: loanId },
    data: { kolCategory: newCategory },
  });

  return newCategory;
}

export async function recalculateAllKOL(tenantId?: string): Promise<void> {
  const loans = await prisma.loan.findMany({
    where: {
      status: 'ACTIVE',
      ...(tenantId ? { tenantId } : {}),
    },
    select: { id: true },
  });

  await Promise.allSettled(loans.map((l) => recalculateKOL(l.id)));
}
