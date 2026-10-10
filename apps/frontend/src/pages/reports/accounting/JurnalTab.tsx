import { useState } from "react";
import { Link } from "react-router-dom";
import type { JurnalReport } from "@siskop/types";
import { formatPeriode, formatTanggalPendek } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_UNITS, unitQueryParam } from "@/lib/unit";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { BalanceChip } from "@/components/reports/BalanceChip";
import { ExportMenu } from "@/components/reports/ExportMenu";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportPager } from "@/components/reports/ReportPager";
import { ReportResultCard, useUnitLabel } from "@/components/reports/ReportResultCard";
import { ReportAmount, STICKY_HEAD, STICKY_TABLE_CONTAINER } from "@/components/reports/ReportTable";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { defaultPeriodFrom, defaultPeriodTo } from "../regulatory/period";
import { sourceHref } from "./drilldown";

const LIMIT = 50;

/** Jurnal Umum (every entry) and Jurnal Penyesuaian (period-end corrections only): one table, one endpoint family. */
export function JurnalTab({ kind }: { kind: "umum" | "penyesuaian" }) {
  const isAdj = kind === "penyesuaian";
  const name = isAdj ? "Jurnal Penyesuaian" : "Jurnal Umum";
  const filter = useReportFilter(`jurnal-${kind}`, () => ({ from: defaultPeriodFrom(), to: defaultPeriodTo(), unitId: ALL_UNITS }));
  const { value: f } = filter;
  const report = useReport<JurnalReport>(`Gagal memuat ${name.toLowerCase()}`);
  const unitLabel = useUnitLabel(f.unitId);
  const [page, setPage] = useState(1);

  const load = (nextPage: number) => {
    setPage(nextPage);
    const path = isAdj ? "jurnal-penyesuaian" : "jurnal-umum";
    void report.run(`/reports/accounting/${path}?from=${f.from}&to=${f.to}&page=${nextPage}&limit=${LIMIT}${unitQueryParam(f.unitId)}`);
  };
  const data = report.data;

  return (
    <div className="space-y-5">
      <ReportFilterCard
        reportName={name.toLowerCase()}
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={() => load(1)}
        onReset={() => {
          filter.reset();
          report.clear();
          setPage(1);
        }}
        isLoading={report.isLoading}
        extra={<UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} includeUnallocated />}
      />

      <ReportResultCard
        reportName={name}
        title={name}
        subtitle={data ? [formatPeriode(data.periode.from, data.periode.to), unitLabel].filter(Boolean).join(" · ") : undefined}
        actions={
          data && (
            <>
              <BalanceChip balanced={data.balanced} difference={Number(data.totalDebit) - Number(data.totalCredit)} />
              <ExportMenu
                pdfViaExport
                report={isAdj ? "jurnal-penyesuaian" : "jurnal-umum"}
                query={`from=${f.from}&to=${f.to}${unitQueryParam(f.unitId)}`}
                stem={`${isAdj ? "jurnal-penyesuaian" : "jurnal-umum"}-${f.from}_${f.to}`}
              />
            </>
          )
        }
        isLoading={report.isLoading}
        hasRun={report.hasRun}
        hasData={!!data && (report.meta.total ?? data.rows.length) > 0}
      >
        {data && (
          <Card>
            <CardContent className="space-y-3 pt-5">
              <Table containerClassName={STICKY_TABLE_CONTAINER}>
                <TableHeader>
                  <TableRow>
                    <TableHead className={`w-16 ${STICKY_HEAD}`}>No</TableHead>
                    <TableHead className={STICKY_HEAD}>Tanggal</TableHead>
                    <TableHead className={STICKY_HEAD}>Kode</TableHead>
                    <TableHead className={STICKY_HEAD}>Nama Akun</TableHead>
                    <TableHead className={STICKY_HEAD}>Keterangan</TableHead>
                    <TableHead className={`text-right ${STICKY_HEAD}`}>Debit</TableHead>
                    <TableHead className={`text-right ${STICKY_HEAD}`}>Kredit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((r) => (
                    <TableRow key={r.lineId}>
                      <TableCell className="tabular-nums">{r.entryNo ?? "-"}</TableCell>
                      <TableCell className="whitespace-nowrap">{formatTanggalPendek(r.entryDate)}</TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs">{r.accountCode}</TableCell>
                      <TableCell>{r.accountName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {sourceHref(r.sourceRef) ? (
                          <Link to={sourceHref(r.sourceRef)!} className="text-primary hover:underline">
                            {r.description}
                          </Link>
                        ) : (
                          r.description
                        )}
                        {r.entryType !== "UMUM" && !isAdj && (
                          <Badge variant="secondary" className="ml-2">
                            {r.entryType === "PENYESUAIAN" ? "Penyesuaian" : "Penutup"}
                          </Badge>
                        )}
                      </TableCell>
                      <ReportAmount value={r.debit} />
                      <ReportAmount value={r.credit} />
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                    <TableCell colSpan={5}>Total seluruh periode</TableCell>
                    <ReportAmount value={data.totalDebit} />
                    <ReportAmount value={data.totalCredit} />
                  </TableRow>
                </TableBody>
              </Table>
              <ReportPager page={page} limit={LIMIT} total={report.meta.total ?? data.rows.length} onPage={load} disabled={report.isLoading} />
            </CardContent>
          </Card>
        )}
      </ReportResultCard>
    </div>
  );
}
