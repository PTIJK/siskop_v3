import { useEffect, useState } from "react";
import type { LabaRugiSection, LaporanHasilUsaha } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText } from "lucide-react";
import { PeriodRangeControls } from "./PeriodRangeControls";
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
                <TableCell className="text-right">{formatRupiah(item.total)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell colSpan={2}>Total {title}</TableCell>
              <TableCell className="text-right">{formatRupiah(section.total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function LabaRugiTab() {
  const { toast } = useToast();
  const [from, setFrom] = useState(defaultPeriodFrom());
  const [to, setTo] = useState(defaultPeriodTo());
  const [data, setData] = useState<LaporanHasilUsaha | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const result = await apiFetch<LaporanHasilUsaha>(`/reports/regulatory/laporan-hasil-usaha?from=${from}&to=${to}`);
      setData(result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal memuat laporan hasil usaha", description: message, variant: "destructive" });
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
      ) : data ? (
        <>
          <p className="text-sm text-muted-foreground">
            Periode {data.periode.from} — {data.periode.to}
          </p>
          <SectionTable title="Pendapatan" section={data.pendapatan} />
          <SectionTable title="Beban" section={data.beban} />
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <p className="text-sm font-semibold">SHU Berjalan (Pendapatan − Beban)</p>
              <p className="text-sm font-semibold">{formatRupiah(data.shuBerjalan)}</p>
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
