import type { TrialBalanceRow } from "@siskop/types";
import { TableCell, TableRow } from "@/components/ui/table";
import { ReportAmount } from "@/components/reports/ReportTable";
import { cn } from "@/lib/utils";
import { hierarchyClass } from "./hierarchy";

/** One chart-of-accounts row, indented by depth; headers bold with their children's roll-up. `onOpen` makes a posting account's name a drill-down link. */
export function TrialBalanceTableRow({ row, onOpen }: { row: TrialBalanceRow; onOpen?: (row: TrialBalanceRow) => void }) {
  return (
    <TableRow className={row.isHeader ? "bg-muted/30" : ""}>
      <TableCell className="font-mono text-xs">{row.code}</TableCell>
      <TableCell className={cn(hierarchyClass(row.level, row.isHeader))}>
        {onOpen && !row.isHeader ? (
          <button type="button" className="text-left text-primary hover:underline" onClick={() => onOpen(row)}>
            {row.name}
          </button>
        ) : (
          row.name
        )}
        {row.isContra && <span className="ml-2 text-xs font-normal text-muted-foreground">(pengurang)</span>}
      </TableCell>
      <ReportAmount value={row.saldoAwal} />
      <ReportAmount value={row.mutasiDebit} />
      <ReportAmount value={row.mutasiKredit} />
      <ReportAmount value={row.saldoAkhir} className="font-medium" />
    </TableRow>
  );
}
