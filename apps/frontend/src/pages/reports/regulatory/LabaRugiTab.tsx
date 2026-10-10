import type { LabaRugiSection, LaporanHasilUsaha } from "@siskop/types";
import { formatPeriode, formatRupiah } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_UNITS, unitQueryParam } from "@/lib/unit";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { PrintButton } from "@/components/reports/PrintButton";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportResultCard, useUnitLabel } from "@/components/reports/ReportResultCard";
import { ReportAmount, ReportTotalRow } from "@/components/reports/ReportTable";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";

function SectionTable({ title, section }: { title: string; section: LabaRugiSection }) {
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
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.map((item) => (
              <TableRow key={item.accountId}>
                <TableCell className="font-mono text-xs">{item.code}</TableCell>
                <TableCell>{item.name}</TableCell>
                <ReportAmount value={item.total} />
              </TableRow>
            ))}
            <ReportTotalRow label={`Total ${title}`} value={section.total} />
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function LabaRugiTab() {
  const filter = useReportFilter("laba-rugi", () => ({ from: defaultPeriodFrom(), to: defaultPeriodTo(), unitId: ALL_UNITS }));
  const { value: f } = filter;
  const report = useReport<LaporanHasilUsaha>("Gagal memuat laporan hasil usaha");
  const unitLabel = useUnitLabel(f.unitId);

  const query = `from=${f.from}&to=${f.to}${unitQueryParam(f.unitId)}`;
  const data = report.data;

  return (
    <div className="space-y-5">
      <ReportFilterCard
        reportName="laporan hasil usaha"
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={() => void report.run(`/reports/regulatory/laporan-hasil-usaha?${query}`)}
        onReset={() => {
          filter.reset();
          report.clear();
        }}
        isLoading={report.isLoading}
        extra={<UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} />}
      />

      <ReportResultCard
        reportName="Laporan Hasil Usaha"
        title="Laporan Hasil Usaha"
        subtitle={data ? [formatPeriode(data.periode.from, data.periode.to), unitLabel].filter(Boolean).join(" · ") : undefined}
        actions={data && <PrintButton path={`/reports/regulatory/laporan-hasil-usaha/pdf?${query}`} filename={`hasil-usaha-${data.periode.from}_${data.periode.to}.pdf`} />}
        isLoading={report.isLoading}
        hasRun={report.hasRun}
        hasData={!!data && data.pendapatan.items.length + data.beban.items.length > 0}
      >
        {data && (
          <>
            <SectionTable title="Pendapatan" section={data.pendapatan} />
            <SectionTable title="Beban" section={data.beban} />
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="flex items-center justify-between py-4">
                <p className="text-sm font-semibold">SHU Berjalan (Pendapatan − Beban)</p>
                <p className="text-sm font-semibold tabular-nums">{formatRupiah(data.shuBerjalan)}</p>
              </CardContent>
            </Card>
          </>
        )}
      </ReportResultCard>
    </div>
  );
}
