import { differenceInCalendarDays } from 'date-fns';
import { formatTanggalPendek } from './utils';

export type BillingBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline';

export interface BillingStatus {
  label: string;
  variant: BillingBadgeVariant;
  className?: string;
}

export function getBillingStatus(nextBillingDate?: string | null): BillingStatus {
  if (!nextBillingDate) {
    return { label: 'Belum diatur', variant: 'outline' };
  }

  const daysUntilDue = differenceInCalendarDays(new Date(nextBillingDate), new Date());
  const dateLabel = formatTanggalPendek(nextBillingDate);

  if (daysUntilDue < 0) {
    return { label: `Jatuh tempo — akses diblokir`, variant: 'destructive' };
  }
  if (daysUntilDue <= 7) {
    return { label: `${dateLabel} (${daysUntilDue} hari lagi)`, variant: 'destructive' };
  }
  if (daysUntilDue <= 30) {
    return {
      label: `${dateLabel} (${daysUntilDue} hari lagi)`,
      variant: 'outline',
      className: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
    };
  }
  return { label: dateLabel, variant: 'secondary' };
}
