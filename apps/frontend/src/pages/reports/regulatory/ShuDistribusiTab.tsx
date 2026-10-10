import { Link } from "react-router-dom";
import type { ShuDistribution } from "@siskop/types";
import { formatPeriode, formatRupiah } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Info } from "lucide-react";
import { PrintButton } from "@/components/reports/PrintButton";
import { ReportFilterCard } from "@/components/reports/ReportFilterCard";
import { ReportResultCard } from "@/components/reports/ReportResultCard";
import { ReportAmount, STICKY_HEAD, STICKY_TABLE_CONTAINER } from "@/components/reports/ReportTable";
import { useReport } from "@/components/reports/useReport";
import { useReportFilter } from "@/components/reports/useReportFilter";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";

export function ShuDistribusiTab() {
  // Cooperative-level statement: no unit filter.
  const filter = useReportFilter("shu-distribusi", () => ({ from: defaultPeriodFrom(), to: defaultPeriodTo() }));
  const { value: f } = filter;
  const report = useReport<ShuDistribution>("Gagal memuat pembagian SHU");

  const query = `from=${f.from}&to=${f.to}`;
  const data = report.data;

  return (
    <div className="space-y-5">
      <ReportFilterCard
        reportName="pembagian SHU"
        from={f.from}
        to={f.to}
        onChange={filter.update}
        onApply={() => void report.run(`/reports/regulatory/shu-distribution?${query}`)}
        onReset={() => {
          filter.reset();
          report.clear();
        }}
        isLoading={report.isLoading}
      />

      {data?.catatan && !report.isLoading ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-6 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p>{data.catatan}</p>
              {!data.alokasi && (
                <Link to="/config" className="mt-1 inline-block text-primary hover:underline">
                  Buka Konfigurasi SHU
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <ReportResultCard
          reportName="Pembagian SHU"
          title="Pembagian SHU"
          subtitle={data ? formatPeriode(data.periode.from, data.periode.to) : undefined}
          actions={data && <PrintButton path={`/reports/regulatory/shu-distribution/pdf?${query}`} filename={`pembagian-shu-${data.periode.from}_${data.periode.to}.pdf`} />}
          isLoading={report.isLoading}
          hasRun={report.hasRun}
          hasData={!!data && (data.anggota.length > 0 || !!data.alokasi)}
        >
          {data && (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {data.alokasi &&
                  [
                    { label: "Jasa Simpanan", bucket: data.alokasi.jasaSimpanan },
                    { label: "Jasa Pinjaman", bucket: data.alokasi.jasaPinjaman },
                    { label: "Cadangan", bucket: data.alokasi.cadangan },
                    { label: "Lainnya", bucket: data.alokasi.lainnya }
                  ].map((item) => (
                    <Card key={item.label}>
                      <CardContent className="pt-4">
                        <p className="text-xs text-muted-foreground">
                          {item.label} ({item.bucket.percent}%)
                        </p>
                        <p className="mt-1 text-lg font-bold tabular-nums">{formatRupiah(item.bucket.total)}</p>
                      </CardContent>
                    </Card>
                  ))}
              </div>

              <Card>
                <CardContent className="pt-5">
                  <Table containerClassName={STICKY_TABLE_CONTAINER}>
                    <TableHeader>
                      <TableRow>
                        <TableHead className={`w-10 ${STICKY_HEAD}`}>No</TableHead>
                        <TableHead className={STICKY_HEAD}>No Anggota</TableHead>
                        <TableHead className={STICKY_HEAD}>Nama</TableHead>
                        <TableHead className={`text-right ${STICKY_HEAD}`}>SHU Pokok/SW</TableHead>
                        <TableHead className={`text-right ${STICKY_HEAD}`}>SHU Sukarela</TableHead>
                        <TableHead className={`text-right ${STICKY_HEAD}`}>SHU Pinjaman</TableHead>
                        <TableHead className={`text-right ${STICKY_HEAD}`}>Total SHU</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.anggota.map((a) => (
                        <TableRow key={a.memberId}>
                          <TableCell>{a.no}</TableCell>
                          <TableCell>{a.memberCode}</TableCell>
                          <TableCell>{a.fullName}</TableCell>
                          <ReportAmount value={a.shuPokokWajib} />
                          <ReportAmount value={a.shuSukarela} />
                          <ReportAmount value={a.jasaPinjaman} />
                          <ReportAmount value={a.totalShu} className="font-semibold" />
                        </TableRow>
                      ))}
                      {data.totalDibagikanKeAnggota && (
                        <TableRow className="bg-muted/50 font-semibold hover:bg-muted/50">
                          <TableCell colSpan={6}>Total Dibagikan ke Anggota</TableCell>
                          <ReportAmount value={data.totalDibagikanKeAnggota} />
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          )}
        </ReportResultCard>
      )}
    </div>
  );
}
