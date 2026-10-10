import type { PerubahanEkuitas } from "@siskop/types";
import { formatPeriode, formatRupiah, formatRupiahOrDash } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ALL_UNITS, unitQueryParam } from "@/lib/unit";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { PrintButton } from "@/components/reports/PrintButton";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportResultCard, useUnitLabel } from "@/components/reports/ReportResultCard";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";

/** Pengurangan arrives as a positive amount; shown negated so each column reads top to bottom. */
function signed(rowKey: string, value: string): string {
  return rowKey === "PENGURANGAN" && Number(value) !== 0 ? `(${formatRupiah(value)})` : formatRupiahOrDash(value);
}

export function PerubahanEkuitasTab() {
  const filter = useReportFilter("perubahan-ekuitas", () => ({ from: defaultPeriodFrom(), to: defaultPeriodTo(), unitId: ALL_UNITS }));
  const { value: f } = filter;
  const report = useReport<PerubahanEkuitas>("Gagal memuat laporan perubahan ekuitas");
  const unitLabel = useUnitLabel(f.unitId);

  const query = `from=${f.from}&to=${f.to}${unitQueryParam(f.unitId)}`;
  const data = report.data;

  return (
    <div className="space-y-5">
      <ReportFilterCard
        reportName="laporan perubahan ekuitas"
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={() => void report.run(`/reports/regulatory/perubahan-ekuitas?${query}`)}
        onReset={() => {
          filter.reset();
          report.clear();
        }}
        isLoading={report.isLoading}
        extra={<UnitFilter value={f.unitId} onChange={(unitId) => filter.update({ unitId })} />}
      />

      <ReportResultCard
        reportName="Perubahan Ekuitas"
        title="Laporan Perubahan Ekuitas"
        subtitle={data ? [formatPeriode(data.periode.from, data.periode.to), unitLabel].filter(Boolean).join(" · ") : undefined}
        actions={data && <PrintButton path={`/reports/regulatory/perubahan-ekuitas/pdf?${query}`} filename={`perubahan-ekuitas-${data.periode.from}_${data.periode.to}.pdf`} />}
        isLoading={report.isLoading}
        hasRun={report.hasRun}
        hasData={!!data && data.rows.length > 0}
      >
        {data && (
          <>
            <Card>
              <CardContent className="pt-5">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-40">Keterangan</TableHead>
                      {data.columns.map((c) => (
                        <TableHead key={c.key} className="min-w-32 text-right">
                          {c.label}
                        </TableHead>
                      ))}
                      <TableHead className="min-w-32 text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row) => {
                      const emphasis = row.key === "SALDO_AWAL" || row.key === "SALDO_AKHIR" ? "bg-muted/50 font-semibold" : "";
                      return (
                        <TableRow key={row.key} className={emphasis}>
                          <TableCell>{row.label}</TableCell>
                          {data.columns.map((c) => (
                            <TableCell key={c.key} className="text-right tabular-nums">
                              {signed(row.key, row.values[c.key] ?? "0")}
                            </TableCell>
                          ))}
                          <TableCell className="text-right tabular-nums">{signed(row.key, row.total)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Modal Sendiri (Permenkop UKM 8/2023)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Awal periode</span>
                  <span className="tabular-nums">{formatRupiah(data.modalSendiri.awal)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Akhir periode</span>
                  <span className="tabular-nums">{formatRupiah(data.modalSendiri.akhir)}</span>
                </div>
                {Number(data.modalSendiri.penyesuaianSaldoAwal) !== 0 && (
                  <p className="text-xs text-muted-foreground">
                    Termasuk penyesuaian saldo awal di luar buku besar sebesar {formatRupiah(data.modalSendiri.penyesuaianSaldoAwal)}.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Simpanan pokok, simpanan wajib, modal tetap, cadangan, dan hibah. Modal penyertaan dan SHU tidak termasuk.
                </p>
              </CardContent>
            </Card>
          </>
        )}
      </ReportResultCard>
    </div>
  );
}
