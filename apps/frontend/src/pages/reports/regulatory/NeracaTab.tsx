import { useEffect, useState } from "react";
import type { Neraca, NeracaSection } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText } from "lucide-react";

function SectionTable({ title, section }: { title: string; section: NeracaSection }) {
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
              <TableHead className="text-right">Saldo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.items.map((item, i) => (
              <TableRow key={item.accountId ?? i}>
                <TableCell className="font-mono text-xs">{item.code ?? "—"}</TableCell>
                <TableCell className={item.isComputed ? "italic text-muted-foreground" : ""}>
                  {item.name}
                  {item.isComputed && (
                    <Badge variant="secondary" className="ml-2">
                      Otomatis
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">{formatRupiah(item.balance)}</TableCell>
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

export function NeracaTab() {
  const { toast } = useToast();
  const [asOfDate, setAsOfDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [data, setData] = useState<Neraca | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      const result = await apiFetch<Neraca>(`/reports/regulatory/neraca?asOfDate=${asOfDate}`);
      setData(result);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal memuat neraca", description: message, variant: "destructive" });
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
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div className="space-y-1">
            <Label className="text-xs">Per Tanggal</Label>
            <Input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-40" />
          </div>
          <Button onClick={fetchReport} disabled={isLoading}>
            <FileText className="mr-2 h-4 w-4" />
            {isLoading ? "Memuat..." : "Tampilkan"}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <PageLoading />
      ) : data ? (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Neraca per {data.asOfDate}</p>
            <Badge variant={data.balanced ? "default" : "destructive"}>{data.balanced ? "Seimbang" : "Tidak Seimbang"}</Badge>
          </div>
          <SectionTable title="Aset" section={data.aset} />
          <SectionTable title="Kewajiban" section={data.kewajiban} />
          <SectionTable title="Ekuitas" section={data.ekuitas} />
          <Card>
            <CardContent className="flex items-center justify-between py-4">
              <p className="text-sm font-semibold">Total Kewajiban dan Ekuitas</p>
              <p className="text-sm font-semibold">{formatRupiah(data.totalKewajibanDanEkuitas)}</p>
            </CardContent>
          </Card>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
          <FileText className="h-10 w-10" />
          <p className="text-sm">Pilih tanggal dan klik &quot;Tampilkan&quot;</p>
        </div>
      )}
    </div>
  );
}
