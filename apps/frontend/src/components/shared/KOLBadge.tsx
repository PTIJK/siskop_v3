import { KOLCategory } from '@siskop/shared';
import { cn } from '../../lib/utils';

const KOL_CONFIG: Record<KOLCategory, { label: string; className: string }> = {
  [KOLCategory.LANCAR]: { label: 'Lancar', className: 'bg-green-100 text-green-800' },
  [KOLCategory.DALAM_PERHATIAN]: { label: 'Dalam Perhatian', className: 'bg-yellow-100 text-yellow-800' },
  [KOLCategory.KURANG_LANCAR]: { label: 'Kurang Lancar', className: 'bg-orange-100 text-orange-800' },
  [KOLCategory.DIRAGUKAN]: { label: 'Diragukan', className: 'bg-red-100 text-red-800' },
  [KOLCategory.MACET]: { label: 'Macet', className: 'bg-red-900 text-red-100' },
};

interface KOLBadgeProps {
  category: KOLCategory | string;
  className?: string;
}

export function KOLBadge({ category, className }: KOLBadgeProps) {
  const config = KOL_CONFIG[category as KOLCategory] ?? { label: category, className: 'bg-gray-100 text-gray-800' };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
