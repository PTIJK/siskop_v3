import type { ReactNode } from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { formatRupiahOrDash } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Amount cell: right-aligned, tabular digits, "-" for zero/empty. */
export function ReportAmount({ value, className }: { value: number | string | null | undefined; className?: string }) {
  return <TableCell className={cn("text-right tabular-nums", className)}>{formatRupiahOrDash(value)}</TableCell>;
}

/** Bold total row spanning `labelSpan` columns, then the amount. */
export function ReportTotalRow({ label, value, labelSpan = 2 }: { label: ReactNode; value: number | string; labelSpan?: number }) {
  return (
    <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
      <TableCell colSpan={labelSpan}>{label}</TableCell>
      <ReportAmount value={value} />
    </TableRow>
  );
}

/** Long tables: pass STICKY_TABLE_CONTAINER as <Table containerClassName> and STICKY_HEAD on <TableHead>. */
export const STICKY_TABLE_CONTAINER = "max-h-[70vh]";
export const STICKY_HEAD = "sticky top-0 z-10 bg-card shadow-[0_1px_0_hsl(var(--border))]";
