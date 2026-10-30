import type { KOLCategory } from "@siskop/types";
import { Badge } from "./Badge";

// "KOL n Nama" with a shape marker (design.md §2.4): the number and the shape
// carry the meaning, so colour is never the only signal.
const KOL_CONFIG: Record<KOLCategory, { label: string; variant: "ok" | "warn" | "bad" }> = {
  LANCAR: { label: "KOL 1 Lancar", variant: "ok" },
  DALAM_PERHATIAN: { label: "KOL 2 Dalam Perhatian", variant: "warn" },
  KURANG_LANCAR: { label: "KOL 3 Kurang Lancar", variant: "warn" },
  DIRAGUKAN: { label: "KOL 4 Diragukan", variant: "bad" },
  MACET: { label: "KOL 5 Macet", variant: "bad" }
};

export function KOLBadge({ category, className }: { category: KOLCategory | string; className?: string }) {
  const config = KOL_CONFIG[category as KOLCategory];
  if (!config) return <Badge variant="secondary" className={className}>{category}</Badge>;
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
