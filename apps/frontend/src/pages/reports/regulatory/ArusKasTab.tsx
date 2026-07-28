import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ArusKas, ArusKasSection } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { FileText, Info } from "lucide-react";
import { PeriodRangeControls } from "./PeriodRangeControls";
import { defaultPeriodFrom, defaultPeriodTo } from "./period";

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
                  <TableCell className="text-right">{formatRupiah(r.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="font-semibold">
                <TableCell>Total {title}</TableCell>
                <TableCell className="text-right">{formatRupiah(section.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function ArusKasTab() {
  const { toast } = useToast();
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [data, setData] = useState<ArusKas | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const result = await apiFetch<ArusKas>(`/reports/regulatory/arus-kas?from=${from}&to=${to}`);
      setData(result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal memuat arus kas", description: message, variant: "destructive" });
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
              <Link to="/config" className="mt-1 inline-block text-primary hover:underline">
                Buka Konfigurasi Akun
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : data ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Periode {data.periode.from} — {data.periode.to}
            </p>
            <Badge variant={data.balanced ? "default" : "destructive"}>{data.balanced ? "Seimbang" : "Tidak Seimbang"}</Badge>
          </div>
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <p className="text-sm font-semibold">Saldo Kas Awal</p>
              <p className="text-sm font-semibold">{formatRupiah(data.saldoKasAwal)}</p>
            </CardContent>
          </Card>
          <ActivitySection title="Aktivitas Operasi" section={data.aktivitasOperasi} />
          <ActivitySection title="Aktivitas Investasi" section={data.aktivitasInvestasi} />
          <ActivitySection title="Aktivitas Pendanaan" section={data.aktivitasPendanaan} />
          <Card>
            <CardContent className="space-y-1 py-4">
              <div className="flex items-center justify-between text-sm">
                <p>Kenaikan (Penurunan) Kas Bersih</p>
                <p>{formatRupiah(data.kenaikanPenurunanKasBersih)}</p>
              </div>
              <div className="flex items-center justify-between text-sm font-semibold">
                <p>Saldo Kas Akhir</p>
                <p>{formatRupiah(data.saldoKasAkhir)}</p>
              </div>
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
