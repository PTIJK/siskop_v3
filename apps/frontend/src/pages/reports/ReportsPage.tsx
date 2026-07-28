import { useState } from "react";
import type { FinancialReport, RATReport } from "@siskop/types";
import { apiFetch, ApiRequestError } from "@/api/client";
import { downloadPdf } from "@/lib/pdf";
import { formatRupiah } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { Download, FileText } from "lucide-react";

type PeriodType = "range" | "monthly" | "yearly";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember"
];
const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

export function ReportsPage() {
  const { can } = usePermissions();
  const { toast } = useToast();
  const [periodType, setPeriodType] = useState<PeriodType>("range");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [financialReport, setFinancialReport] = useState<FinancialReport | null>(null);
  const [ratReport, setRatReport] = useState<RATReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("financial");

  const getDateRange = () => {
    if (periodType === "range") return { startDate, endDate };
    if (periodType === "monthly") {
      const m = month.padStart(2, "0");
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      return { startDate: `${year}-${m}-01`, endDate: `${year}-${m}-${lastDay}` };
    }
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  };

  const fetchReport = async () => {
    setIsLoading(true);
    try {
      if (activeTab === "financial") {
        const { startDate: sd, endDate: ed } = getDateRange();
        if (!sd || !ed) return;
        const data = await apiFetch<FinancialReport>(`/reports/financial?startDate=${sd}&endDate=${ed}`);
        setFinancialReport(data);
      } else {
        const data = await apiFetch<RATReport>(`/reports/rat?year=${year}`);
        setRatReport(data);
      }
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "Terjadi kesalahan";
      toast({ title: "Gagal memuat laporan", description: message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const downloadPDF = async () => {
    try {
      if (activeTab === "financial") {
        const { startDate: sd, endDate: ed } = getDateRange();
        await downloadPdf(`/reports/financial/pdf?startDate=${sd}&endDate=${ed}`, `laporan-keuangan-${Date.now()}.pdf`);
      } else {
        await downloadPdf(`/reports/rat/pdf?year=${year}`, `laporan-rat-${year}.pdf`);
      }
    } catch {
      toast({ title: "Gagal mengunduh PDF", variant: "destructive" });
    }
  };

  const hasReport = financialReport || ratReport;

  return (
    <div className="space-y-6">
      <PageHeader title="Laporan" description="Laporan keuangan dan RAT koperasi" />

      <Card>
        <CardContent className="pt-5">
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block text-sm">Periode</Label>
              <RadioGroup value={periodType} onValueChange={(v) => setPeriodType(v as PeriodType)} className="flex flex-wrap gap-4">
                {[
                  { value: "range", label: "Range Tanggal" },
                  { value: "monthly", label: "Bulanan" },
                  { value: "yearly", label: "Tahunan" }
                ].map((opt) => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <RadioGroupItem value={opt.value} id={opt.value} />
                    <Label htmlFor={opt.value}>{opt.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              {periodType === "range" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Dari</Label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-40" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Sampai</Label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-40" />
                  </div>
                </>
              )}
              {periodType === "monthly" && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Bulan</Label>
                    <Select value={month} onValueChange={setMonth}>
                      <SelectTrigger className="w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => (
                          <SelectItem key={i} value={String(i + 1)}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tahun</Label>
                    <Select value={year} onValueChange={setYear}>
                      <SelectTrigger className="w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => (
                          <SelectItem key={y} value={String(y)}>
                            {y}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {periodType === "yearly" && (
                <div className="space-y-1">
                  <Label className="text-xs">Tahun</Label>
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => (
                        <SelectItem key={y} value={String(y)}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button onClick={fetchReport} disabled={isLoading}>
                <FileText className="mr-2 h-4 w-4" />
                {isLoading ? "Memuat..." : "Tampilkan Laporan"}
              </Button>
              {hasReport && can("reports", "export") && (
                <Button variant="outline" onClick={downloadPDF}>
                  <Download className="mr-2 h-4 w-4" /> Download PDF
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v);
          setFinancialReport(null);
          setRatReport(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="financial">Laporan Keuangan</TabsTrigger>
          <TabsTrigger value="rat">Laporan RAT</TabsTrigger>
        </TabsList>

        <TabsContent value="financial" className="mt-4 space-y-5">
          {isLoading ? (
            <PageLoading />
          ) : financialReport ? (
            <>
              <p className="text-xs text-muted-foreground">
                Periode: {financialReport.periode.start} s/d {financialReport.periode.end}
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  { label: "Saldo Akhir Simpanan", value: financialReport.saldoAkhirSimpanan },
                  { label: "Sisa Pinjaman Outstanding", value: financialReport.sisaPinjamanOutstanding },
                  { label: "Angsuran Diterima", value: financialReport.pinjaman.angsuranDiterima.total }
                ].map((item) => (
                  <Card key={item.label}>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-xl font-bold">{formatRupiah(item.value)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Rincian Simpanan per Jenis</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Jenis</TableHead>
                        <TableHead>Nama Simpanan</TableHead>
                        <TableHead className="text-right">Jumlah Rekening</TableHead>
                        <TableHead className="text-right">Total Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {financialReport.simpananPerJenis.map((s, i) => (
                        <TableRow key={i}>
                          <TableCell>{s.type}</TableCell>
                          <TableCell>{s.name}</TableCell>
                          <TableCell className="text-right">{s.count}</TableCell>
                          <TableCell className="text-right font-semibold">{formatRupiah(s.totalBalance)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Rincian Transaksi Simpanan</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Jenis Transaksi</TableHead>
                        <TableHead className="text-right">Jumlah Transaksi</TableHead>
                        <TableHead className="text-right">Total Nominal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>Setoran</TableCell>
                        <TableCell className="text-right">{financialReport.transaksiSimpanan.deposit.count}</TableCell>
                        <TableCell className="text-right font-semibold text-green-700">
                          {formatRupiah(financialReport.transaksiSimpanan.deposit.total)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Penarikan</TableCell>
                        <TableCell className="text-right">{financialReport.transaksiSimpanan.withdrawal.count}</TableCell>
                        <TableCell className="text-right font-semibold text-orange-700">
                          {formatRupiah(financialReport.transaksiSimpanan.withdrawal.total)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Rincian Pinjaman</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Keterangan</TableHead>
                        <TableHead className="text-right">Jumlah</TableHead>
                        <TableHead className="text-right">Total Nominal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>Pinjaman Dicairkan</TableCell>
                        <TableCell className="text-right">{financialReport.pinjaman.dicairkan.count}</TableCell>
                        <TableCell className="text-right font-semibold">{formatRupiah(financialReport.pinjaman.dicairkan.total)}</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>Angsuran Diterima</TableCell>
                        <TableCell className="text-right">{financialReport.pinjaman.angsuranDiterima.count}</TableCell>
                        <TableCell className="text-right font-semibold text-green-700">
                          {formatRupiah(financialReport.pinjaman.angsuranDiterima.total)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <FileText className="h-10 w-10" />
              <p className="text-sm">Pilih periode dan klik &quot;Tampilkan Laporan&quot;</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="rat" className="mt-4">
          {isLoading ? (
            <PageLoading />
          ) : ratReport ? (
            <div className="space-y-5">
              <p className="text-xs text-muted-foreground">Tahun {ratReport.tahun}</p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  { label: "Anggota Awal Tahun", value: `${ratReport.keanggotaan.awalTahun} orang` },
                  { label: "Anggota Akhir Tahun", value: `${ratReport.keanggotaan.akhirTahun} orang` },
                  { label: "Pertumbuhan Anggota", value: `${ratReport.keanggotaan.pertumbuhan} orang` },
                  { label: "Pinjaman Diberikan", value: formatRupiah(ratReport.pinjaman.diberikan.total) },
                  { label: "Jumlah Pinjaman Diberikan", value: `${ratReport.pinjaman.diberikan.count} pinjaman` },
                  { label: "Pinjaman Lunas", value: `${ratReport.pinjaman.lunas} pinjaman` }
                ].map((item) => (
                  <Card key={item.label}>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-xl font-bold">{item.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Simpanan per Jenis</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Jenis</TableHead>
                        <TableHead>Nama Simpanan</TableHead>
                        <TableHead className="text-right">Jumlah Rekening</TableHead>
                        <TableHead className="text-right">Total Saldo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ratReport.simpanan.map((s, i) => (
                        <TableRow key={i}>
                          <TableCell>{s.type}</TableCell>
                          <TableCell>{s.jenis}</TableCell>
                          <TableCell className="text-right">{s.jumlahRekening}</TableCell>
                          <TableCell className="text-right font-semibold">{formatRupiah(s.totalSaldo)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Distribusi Kualitas Pinjaman (KOL)</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kategori</TableHead>
                        <TableHead className="text-right">Jumlah</TableHead>
                        <TableHead className="text-right">Persentase</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ratReport.kolDistribution.map((k, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <KOLBadge category={k.category} />
                          </TableCell>
                          <TableCell className="text-right">{k.count}</TableCell>
                          <TableCell className="text-right font-semibold">{k.percentage}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <FileText className="h-10 w-10" />
              <p className="text-sm">Pilih periode dan klik &quot;Tampilkan Laporan&quot;</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
