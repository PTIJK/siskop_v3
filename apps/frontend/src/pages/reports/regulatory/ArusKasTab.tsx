import { Link } from "react-router-dom";
import type { ArusKas, ArusKasSection } from "@siskop/types";
import { formatPeriode, formatRupiah } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Info } from "lucide-react";
import { unitQueryParam } from "@/lib/unit";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { BalanceChip } from "@/components/reports/BalanceChip";
import { ExportMenu } from "@/components/reports/ExportMenu";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportResultCard, useUnitLabel } from "@/components/reports/ReportResultCard";
import { ReportAmount, ReportTotalRow } from "@/components/reports/ReportTable";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";
import { currentUnitScope } from "@/stores/unit-scope";

function ActivitySection({ title, section }: { title: string; section: ArusKasSection }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {section.rincian.length === 0 ? (
          <p className="text-sm text-muted-foreground">Tidak ada transaksi pada periode ini.</p>
        ) : (
          <Table>
            <TableBody>
              {section.rincian.map((r, i) => (
                <TableRow key={i}>
                  <TableCell>{r.label}</TableCell>
                  <ReportAmount value={r.amount} />
                </TableRow>
              ))}
              <ReportTotalRow label={`Total ${title}`} value={section.total} labelSpan={1} />
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function ArusKasTab() {
  const filter = useReportFilter("arus-kas", () => ({ from: defaultPeriodFrom(), to: defaultPeriodTo(), unitId: currentUnitScope() }));
  const { value: f } = filter;
  const report = useReport<ArusKas>("Gagal memuat arus kas");
  const unitLabel = useUnitLabel(f.unitId);

  const query = `from=${f.from}&to=${f.to}${unitQueryParam(f.unitId)}`;
  const data = report.data;
  const hasRows = !!data && data.aktivitasOperasi.rincian.length + data.aktivitasInvestasi.rincian.length + data.aktivitasPendanaan.rincian.length > 0;

  return (
    <div className="space-y-5">
      <ReportFilterCard
        reportName="arus kas"
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={() => void report.run(`/reports/regulatory/arus-kas?${query}`)}
        onReset={() => {
          filter.reset();
          report.clear();
        }}
        isLoading={report.isLoading}
        extra={<UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} />}
      />

      {/* A "catatan" response (no cash account configured) replaces the report with guidance. */}
      {data?.catatan && !report.isLoading ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-6 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p>{data.catatan}</p>
              <Link to="/config" className="mt-1 inline-block text-primary hover:underline">
                Buka Konfigurasi Akun
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ReportResultCard
          reportName="Arus Kas"
          title="Laporan arus kas"
          subtitle={data ? [formatPeriode(data.periode.from, data.periode.to), unitLabel].filter(Boolean).join(" · ") : undefined}
          actions={
            data && (
              <>
                <BalanceChip balanced={data.balanced} difference={Number(data.saldoKasAkhir) - Number(data.saldoKasAkhirAktual)} />
                <ExportMenu report="arus-kas" query={query} stem={`arus-kas-${data.periode.from}_${data.periode.to}`} pdfPath={`/reports/regulatory/arus-kas/pdf?${query}`} />
              </>
            )
          }
          isLoading={report.isLoading}
          hasRun={report.hasRun}
          hasData={hasRows || (!!data && Number(data.saldoKasAwal) !== 0)}
        >
          {data && (
            <>
              <Card>
                <CardContent className="flex items-center justify-between py-4">
                  <p className="text-sm font-semibold">Saldo Kas Awal</p>
                  <p className="text-sm font-semibold tabular-nums">{formatRupiah(data.saldoKasAwal)}</p>
                </CardContent>
              </Card>
              <ActivitySection title="Aktivitas operasi" section={data.aktivitasOperasi} />
              <ActivitySection title="Aktivitas investasi" section={data.aktivitasInvestasi} />
              <ActivitySection title="Aktivitas pendanaan" section={data.aktivitasPendanaan} />
              <Card>
                <CardContent className="space-y-1 py-4">
                  <div className="flex items-center justify-between text-sm">
                    <p>Kenaikan (Penurunan) Kas Bersih</p>
                    <p className="tabular-nums">{formatRupiah(data.kenaikanPenurunanKasBersih)}</p>
                  </div>
                  <div className="flex items-center justify-between text-sm font-semibold">
                    <p>Saldo Kas Akhir</p>
                    <p className="tabular-nums">{formatRupiah(data.saldoKasAkhir)}</p>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </ReportResultCard>
      )}
    </div>
  );
}
