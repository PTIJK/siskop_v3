import { Link } from "react-router-dom";
import type { TrialBalanceRow } from "@siskop/types";
import { TableCell, TableRow } from "@/components/ui/table";
import { CompareCells } from "@/components/reports/CompareCells";
import { ReportAmount } from "@/components/reports/ReportTable";
import { cn } from "@/lib/utils";
import { hierarchyClass } from "./hierarchy";

/**
 * One chart-of-accounts row, indented by depth; headers bold with their children's roll-up. A posting
 * account's name becomes a drill-down: `onOpen` for in-page navigation, or `hrefFor` for a link to another page.
 */
export function TrialBalanceTableRow({
  row,
  onOpen,
  hrefFor,
  compare
}: {
  row: TrialBalanceRow;
  onOpen?: (row: TrialBalanceRow) => void;
  hrefFor?: (row: TrialBalanceRow) => string;
  /** Turns the comparison columns on: the same account's closing balance in the earlier period. */
  compare?: { previousSaldoAkhir: string | undefined };
}) {
  return (
    <TableRow className={row.isHeader ? "bg-muted/30" : ""}>
      <TableCell className="whitespace-nowrap font-mono text-xs">{row.code}</TableCell>
      <TableCell className={cn(hierarchyClass(row.level, row.isHeader))}>
        {hrefFor && !row.isHeader ? (
          <Link to={hrefFor(row)} className="text-primary hover:underline">
            {row.name}
          </Link>
        ) : onOpen && !row.isHeader ? (
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
      {compare && <CompareCells current={row.saldoAkhir} previous={compare.previousSaldoAkhir} />}
    </TableRow>
  );
}
