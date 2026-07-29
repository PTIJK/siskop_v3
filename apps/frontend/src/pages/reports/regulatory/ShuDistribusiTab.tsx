import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ShuDistribution } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Info } from "lucide-react";
import { PeriodRangeControls } from "./PeriodRangeControls";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";

export function ShuDistribusiTab() {
  const { toast } = useToast();
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [data, setData] = useState<ShuDistribution | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const result = await apiFetch<ShuDistribution>(`/reports/regulatory/shu-distribution?from=${from}&to=${to}`);
      setData(result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal memuat pembagian SHU", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchReport();
  }, []);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="pt-5">
          <PeriodRangeControls from={from} to={to} onFromChange={setFrom} onToChange={setTo} onSubmit={fetchReport} isLoading={isLoading} />
        </CardContent>
      </Card>

      {isLoading ? (
        <PageLoading />
      ) : data?.catatan ? (
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
      ) : data ? (
        <>
          <p className="text-sm text-muted-foreground">
            Periode {data.periode.from} — {data.periode.to}
          </p>

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
                    <p className="mt-1 text-lg font-bold">{formatRupiah(item.bucket.total)}</p>
                  </CardContent>
                </Card>
              ))}
          </div>

          <Card>
            <CardContent className="pt-5">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">No</TableHead>
                    <TableHead>No Anggota</TableHead>
                    <TableHead>Nama</TableHead>
                    <TableHead className="text-right">SHU Pokok/SW</TableHead>
                    <TableHead className="text-right">SHU Sukarela</TableHead>
                    <TableHead className="text-right">SHU Pinjaman</TableHead>
                    <TableHead className="text-right">Total SHU</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.anggota.map((a) => (
                    <TableRow key={a.memberId}>
                      <TableCell>{a.no}</TableCell>
                      <TableCell>{a.memberCode}</TableCell>
                      <TableCell>{a.fullName}</TableCell>
                      <TableCell className="text-right">{formatRupiah(a.shuPokokWajib)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(a.shuSukarela)}</TableCell>
                      <TableCell className="text-right">{formatRupiah(a.jasaPinjaman)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatRupiah(a.totalShu)}</TableCell>
                    </TableRow>
                  ))}
                  {data.totalDibagikanKeAnggota && (
                    <TableRow className="font-semibold">
                      <TableCell colSpan={6}>Total Dibagikan ke Anggota</TableCell>
                      <TableCell className="text-right">{formatRupiah(data.totalDibagikanKeAnggota)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <FileText className="h-10 w-10" />
          <p className="text-sm">Pilih periode dan klik &quot;Tampilkan&quot;</p>
        </div>
      )}
    </div>
  );
}
