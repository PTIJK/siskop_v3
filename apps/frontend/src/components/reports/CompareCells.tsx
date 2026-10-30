import { TableCell, TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { formatRupiahOrDash } from "@/lib/format";
import { formatDeltaPct, rowDelta } from "./compare";
import { STICKY_HEAD } from "./ReportTable";

/** Three header cells for a comparison: the earlier figure, the change, and the change in percent. */
export function CompareHeads({ label, sticky }: { label: string; sticky?: boolean }) {
  const cls = cn("text-right", sticky && STICKY_HEAD);
  return (
    <>
      <TableHead className={cls}>{label}</TableHead>
      <TableHead className={cls}>Selisih</TableHead>
      <TableHead className={cls}>%</TableHead>
    </>
  );
}

/**
 * The matching three cells of a row. `higherIsBetter` colours the change: income and
 * assets growing read green, expenses growing read orange; omit it for neutral lines.
 */
export function CompareCells({
  current,
  previous,
  higherIsBetter,
  className
}: {
  current: string;
  previous: string | undefined;
  higherIsBetter?: boolean;
  className?: string;
}) {
  const { amount, pct } = rowDelta(current, previous);
  const tone =
    higherIsBetter === undefined || amount === 0 ? "" : (amount > 0) === higherIsBetter ? "text-success" : "text-warning";
  return (
    <>
      <TableCell className={cn("text-right tabular-nums text-muted-foreground", className)}>{formatRupiahOrDash(previous)}</TableCell>
      <TableCell className={cn("text-right tabular-nums", tone, className)}>{amount === 0 ? "-" : formatRupiahOrDash(amount)}</TableCell>
      <TableCell className={cn("text-right tabular-nums", tone, className)}>{formatDeltaPct(pct)}</TableCell>
    </>
  );
}
