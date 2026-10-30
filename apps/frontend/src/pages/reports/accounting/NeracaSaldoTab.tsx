import type { TrialBalance } from "@siskop/types";
import { formatPeriode } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { unitQueryParam } from "@/lib/unit";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { BalanceChip } from "@/components/reports/BalanceChip";
import { ExportMenu } from "@/components/reports/ExportMenu";
import { CompareHeads } from "@/components/reports/CompareCells";
import { CompareSelect } from "@/components/reports/CompareSelect";
import { COMPARE_NONE, compareQueryParam } from "@/components/reports/compare";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportResultCard, useUnitLabel } from "@/components/reports/ReportResultCard";
import { ReportAmount, STICKY_HEAD, STICKY_TABLE_CONTAINER } from "@/components/reports/ReportTable";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { defaultPeriodFrom, defaultPeriodTo } from "../regulatory/period";
import { bukuBesarHref } from "./drilldown";
import { TrialBalanceTableRow } from "./TrialBalanceTable";
import { currentUnitScope } from "@/stores/unit-scope";

export function NeracaSaldoTab() {
  const filter = useReportFilter("neraca-saldo", () => ({ from: defaultPeriodFrom(), to: defaultPeriodTo(), unitId: currentUnitScope(), compare: COMPARE_NONE }));
  const { value: f } = filter;
  const report = useReport<TrialBalance>("Gagal memuat neraca saldo");
  const unitLabel = useUnitLabel(f.unitId);
  const data = report.data;
  const previous = data?.comparison ? new Map(data.comparison.rows.map((r) => [r.accountId, r.saldoAkhir])) : null;

  return (
    <div className="space-y-5">
      <ReportFilterCard
        reportName="neraca saldo"
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={() => void report.run(`/reports/accounting/neraca-saldo?from=${f.from}&to=${f.to}${unitQueryParam(f.unitId)}${compareQueryParam(f.compare)}`)}
        onReset={() => {
          filter.reset();
          report.clear();
        }}
        isLoading={report.isLoading}
        extra={
          <>
            <UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} includeUnallocated />
            <CompareSelect value={f.compare} onChange={(compare) => filter.update({ compare })} />
          </>
        }
      />

      <ReportResultCard
        reportName="Neraca Saldo"
        title="Neraca saldo"
        subtitle={
          data
            ? [
                formatPeriode(data.periode.from, data.periode.to),
                data.comparison && `dibandingkan dengan ${formatPeriode(data.comparison.periode.from, data.comparison.periode.to)}`,
                unitLabel
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        actions={
          data && (
            <>
              <BalanceChip balanced={data.balanced} difference={Number(data.totals.mutasiDebit) - Number(data.totals.mutasiKredit)} />
              <ExportMenu pdfViaExport report="neraca-saldo" query={`from=${f.from}&to=${f.to}${unitQueryParam(f.unitId)}`} stem={`neraca-saldo-${f.from}_${f.to}`} />
            </>
          )
        }
        isLoading={report.isLoading}
        hasRun={report.hasRun}
        hasData={!!data && data.rows.some((r) => Number(r.saldoAwal) || Number(r.mutasiDebit) || Number(r.mutasiKredit) || Number(r.saldoAkhir))}
      >
        {data && (
          <Card>
            <CardContent className="pt-5">
              <Table containerClassName={STICKY_TABLE_CONTAINER}>
                <TableHeader>
                  <TableRow>
                    <TableHead className={`w-24 ${STICKY_HEAD}`}>Kode</TableHead>
                    <TableHead className={STICKY_HEAD}>Nama Akun</TableHead>
                    <TableHead className={`text-right ${STICKY_HEAD}`}>Saldo Awal</TableHead>
                    <TableHead className={`text-right ${STICKY_HEAD}`}>Debit</TableHead>
                    <TableHead className={`text-right ${STICKY_HEAD}`}>Kredit</TableHead>
                    <TableHead className={`text-right ${STICKY_HEAD}`}>Saldo Akhir</TableHead>
                    {previous && <CompareHeads label="Akhir pembanding" sticky />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TrialBalanceTableRow key={r.accountId} row={r} compare={previous ? { previousSaldoAkhir: previous.get(r.accountId) } : undefined} hrefFor={(row) => bukuBesarHref(row.accountId, { from: data.periode.from, to: data.periode.to, unitId: f.unitId })} />
                  ))}
                  <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                    <TableCell colSpan={3}>Total</TableCell>
                    <ReportAmount value={data.totals.mutasiDebit} />
                    <ReportAmount value={data.totals.mutasiKredit} />
                    <TableCell colSpan={previous ? 4 : 1} />
                  </TableRow>
                </TableBody>
              </Table>
              <p className="mt-3 text-xs text-muted-foreground">
                Klik nama akun untuk membuka buku besarnya. Saldo ditulis pada sisi normal akun; akun pengurang (kontra) tidak dinetralkan di sini. Total saldo akhir sisi debit{" "}
                {data.totals.saldoAkhirDebit}, sisi kredit {data.totals.saldoAkhirKredit}.
              </p>
            </CardContent>
          </Card>
        )}
      </ReportResultCard>
    </div>
  );
}
