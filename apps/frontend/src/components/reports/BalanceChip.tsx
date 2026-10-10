import { Badge } from "@/components/ui/badge";
import { formatRupiah } from "@/lib/format";

/** Accounting-identity check next to a report title. When unbalanced, shows the gap if known. */
export function BalanceChip({ balanced, difference }: { balanced: boolean; difference?: number | string }) {
  const gap = difference === undefined ? 0 : Math.abs(Number(difference));
  return (
    <Badge variant={balanced ? "default" : "destructive"}>
      {balanced ? "Seimbang" : gap > 0 ? `Tidak Seimbang (selisih ${formatRupiah(gap)})` : "Tidak Seimbang"}
    </Badge>
  );
}
