import type { KOLCategory } from "@siskop/types";
import { cn } from "@/lib/utils";

const KOL_CONFIG: Record<KOLCategory, { label: string; className: string }> = {
  LANCAR: { label: "Lancar", className: "bg-green-100 text-green-800" },
  DALAM_PERHATIAN: { label: "Dalam Perhatian", className: "bg-yellow-100 text-yellow-800" },
  KURANG_LANCAR: { label: "Kurang Lancar", className: "bg-orange-100 text-orange-800" },
  DIRAGUKAN: { label: "Diragukan", className: "bg-red-100 text-red-800" },
  MACET: { label: "Macet", className: "bg-red-900 text-red-100" }
};

export function KOLBadge({ category, className }: { category: KOLCategory | string; className?: string }) {
  const config = KOL_CONFIG[category as KOLCategory] ?? { label: category, className: "bg-gray-100 text-gray-800" };
  return (
    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", config.className, className)}>
      {config.label}
    </span>
  );
}
