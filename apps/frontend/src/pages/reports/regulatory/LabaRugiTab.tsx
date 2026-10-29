import { Link } from "react-router-dom";
import type { LabaRugiSection, LaporanHasilUsaha } from "@siskop/types";
import { formatPeriode, formatRupiah } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { unitQueryParam } from "@/lib/unit";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { CompareCells, CompareHeads } from "@/components/reports/CompareCells";
import { CompareSelect } from "@/components/reports/CompareSelect";
import { COMPARE_NONE, compareQueryParam } from "@/components/reports/compare";
import { ExportMenu } from "@/components/reports/ExportMenu";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportResultCard, useUnitLabel } from "@/components/reports/ReportResultCard";
import { ReportAmount, ReportTotalRow } from "@/components/reports/ReportTable";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { bukuBesarHref } from "../accounting/drilldown";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";
import { currentUnitScope } from "@/stores/unit-scope";

function SectionTable({
  title,
  section,
  previous,
  ledgerHref
}: {
  title: string;
  section: LabaRugiSection;
  /** The same section for the comparison period; its presence turns the comparison columns on. */
  previous?: LabaRugiSection;
  ledgerHref: (accountId: string) => string;
}) {
  const before = previous ? new Map(previous.items.map((i) => [i.accountId, i.total])) : null;
  // More income is good, more expense is not.
  const better = title === "Pendapatan";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kode</TableHead>
              <TableHead>Nama Akun</TableHead>
              <TableHead className="text-right">Jumlah</TableHead>
              {before && <CompareHeads label="Pembanding" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.map((item) => (
              <TableRow key={item.accountId}>
                <TableCell className="font-mono text-xs">{item.code}</TableCell>
                <TableCell>
                  {item.isHeader ? (
                    item.name
                  ) : (
                    <Link to={ledgerHref(item.accountId)} className="text-primary hover:underline">
                      {item.name}
                    </Link>
                  )}
                </TableCell>
                <ReportAmount value={item.total} />
                {before && <CompareCells current={item.total} previous={before.get(item.accountId)} higherIsBetter={better} />}
              </TableRow>
            ))}
            {before && previous ? (
              <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                <TableCell colSpan={2}>Total {title}</TableCell>
                <ReportAmount value={section.total} />
                <CompareCells current={section.total} previous={previous.total} higherIsBetter={better} />
              </TableRow>
            ) : (
              <ReportTotalRow label={`Total ${title}`} value={section.total} />
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function LabaRugiTab() {
  const filter = useReportFilter("laba-rugi", () => ({ from: defaultPeriodFrom(), to: defaultPeriodTo(), unitId: currentUnitScope(), compare: COMPARE_NONE }));
  const { value: f } = filter;
  const report = useReport<LaporanHasilUsaha>("Gagal memuat laporan hasil usaha");
  const unitLabel = useUnitLabel(f.unitId);

  const query = `from=${f.from}&to=${f.to}${unitQueryParam(f.unitId)}`;
  const data = report.data;
  const previous = data?.comparison;
  const ledgerHref = (accountId: string) => bukuBesarHref(accountId, { from: f.from, to: f.to, unitId: f.unitId });

  return (
    <div className="space-y-5">
      <ReportFilterCard
        reportName="laporan hasil usaha"
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={() => void report.run(`/reports/regulatory/laporan-hasil-usaha?${query}${compareQueryParam(f.compare)}`)}
        onReset={() => {
          filter.reset();
          report.clear();
        }}
        isLoading={report.isLoading}
        extra={
          <>
            <UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} />
            <CompareSelect value={f.compare} onChange={(compare) => filter.update({ compare })} />
          </>
        }
      />

      <ReportResultCard
        reportName="Laporan Hasil Usaha"
        title="Laporan Hasil Usaha"
        subtitle={
          data
            ? [
                formatPeriode(data.periode.from, data.periode.to),
                previous && `dibandingkan dengan ${formatPeriode(previous.periode.from, previous.periode.to)}`,
                unitLabel
              ]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        actions={data && <ExportMenu report="laporan-hasil-usaha" query={query} stem={`hasil-usaha-${data.periode.from}_${data.periode.to}`} pdfPath={`/reports/regulatory/laporan-hasil-usaha/pdf?${query}`} />}
        isLoading={report.isLoading}
        hasRun={report.hasRun}
        hasData={!!data && data.pendapatan.items.length + data.beban.items.length > 0}
      >
        {data && (
          <>
            <SectionTable title="Pendapatan" section={data.pendapatan} previous={previous?.pendapatan} ledgerHref={ledgerHref} />
            <SectionTable title="Beban" section={data.beban} previous={previous?.beban} ledgerHref={ledgerHref} />
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex items-center justify-between py-4">
                <p className="text-sm font-semibold">SHU Berjalan (Pendapatan − Beban)</p>
                <p className="text-sm font-semibold tabular-nums">
                  {formatRupiah(data.shuBerjalan)}
                  {previous && (
                    <span className="ml-3 text-xs font-normal text-muted-foreground">pembanding {formatRupiah(previous.shuBerjalan)}</span>
                  )}
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </ReportResultCard>
    </div>
  );
}
