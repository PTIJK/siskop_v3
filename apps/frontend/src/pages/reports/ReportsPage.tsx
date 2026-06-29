import { useState } from 'react';
import api from '../../lib/api';
import { formatRupiah } from '../../lib/utils';
import { usePermissions } from '../../hooks/usePermissions';
import { PageHeader } from '../../components/shared/PageHeader';
import { PageLoading } from '../../components/shared/LoadingSpinner';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { RadioGroup, RadioGroupItem } from '../../components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import { Download, FileText } from 'lucide-react';

type PeriodType = 'range' | 'monthly' | 'yearly';

interface FinancialReport {
  summary: {
    totalSavings: string;
    totalLoansOutstanding: string;
    totalPaymentsReceived: string;
  };
  savingsByType: { type: string; configName: string; accountCount: number; totalBalance: string }[];
  savingTransactions: { period: string; totalDeposit: string; totalWithdrawal: string; net: string }[];
  loansByType: { configName: string; disbursed: string; paymentsReceived: string; outstanding: string }[];
}

interface RATReport {
  period: string;
  totalAssets: string;
  totalLiabilities: string;
  equity: string;
  income: string;
  expenses: string;
  netIncome: string;
  memberCount: number;
  savingsGrowth: string;
  loansGrowth: string;
}

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

export function ReportsPage() {
  const { can } = usePermissions();
  const [periodType, setPeriodType] = useState<PeriodType>('range');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [financialReport, setFinancialReport] = useState<FinancialReport | null>(null);
  const [ratReport, setRatReport] = useState<RATReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('financial');

  const getDateRange = () => {
    if (periodType === 'range') return { startDate, endDate };
    if (periodType === 'monthly') {
      const m = month.padStart(2, '0');
      const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
      return { startDate: `${year}-${m}-01`, endDate: `${year}-${m}-${lastDay}` };
    }
    return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
  };

  const fetchReport = async () => {
    const { startDate: sd, endDate: ed } = getDateRange();
    if (!sd || !ed) return;
    setIsLoading(true);
    try {
      if (activeTab === 'financial') {
        const res = await api.get('/api/tenant/reports/financial', { params: { startDate: sd, endDate: ed } });
        setFinancialReport(res.data.data);
      } else {
        const res = await api.get('/api/tenant/reports/rat', { params: { startDate: sd, endDate: ed } });
        setRatReport(res.data.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const downloadPDF = async () => {
    const { startDate: sd, endDate: ed } = getDateRange();
    const endpoint = activeTab === 'financial' ? 'financial' : 'rat';
    const response = await api.get(`/api/tenant/reports/${endpoint}/pdf`, {
      params: { startDate: sd, endDate: ed },
      responseType: 'blob',
    });
    const url = URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `laporan-${endpoint}-${Date.now()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const hasReport = financialReport || ratReport;

  return (
    <div className="space-y-6">
      <PageHeader title="Laporan" description="Laporan keuangan dan RAT koperasi" />

      {/* Filter bar */}
      <Card>
        <CardContent className="pt-5">
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block text-sm">Periode</Label>
              <RadioGroup
                value={periodType}
                onValueChange={(v) => setPeriodType(v as PeriodType)}
                className="flex flex-wrap gap-4"
              >
                {[
                  { value: 'range', label: 'Range Tanggal' },
                  { value: 'monthly', label: 'Bulanan' },
                  { value: 'yearly', label: 'Tahunan' },
                ].map((opt) => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <RadioGroupItem value={opt.value} id={opt.value} />
                    <Label htmlFor={opt.value}>{opt.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              {periodType === 'range' && (
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
              {periodType === 'monthly' && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Bulan</Label>
                    <Select value={month} onValueChange={setMonth}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Tahun</Label>
                    <Select value={year} onValueChange={setYear}>
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {periodType === 'yearly' && (
                <div className="space-y-1">
                  <Label className="text-xs">Tahun</Label>
                  <Select value={year} onValueChange={setYear}>
                    <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button onClick={fetchReport} disabled={isLoading}>
                <FileText className="mr-2 h-4 w-4" />
                {isLoading ? 'Memuat...' : 'Tampilkan Laporan'}
              </Button>
              {hasReport && can('reports', 'export') && (
                <Button variant="outline" onClick={downloadPDF}>
                  <Download className="mr-2 h-4 w-4" /> Download PDF
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); setFinancialReport(null); setRatReport(null); }}>
        <TabsList>
          <TabsTrigger value="financial">Laporan Keuangan</TabsTrigger>
          <TabsTrigger value="rat">Laporan RAT</TabsTrigger>
        </TabsList>

        <TabsContent value="financial" className="mt-4 space-y-5">
          {isLoading ? (
            <PageLoading />
          ) : financialReport ? (
            <>
              {/* Summary */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                {[
                  { label: 'Total Simpanan', value: financialReport.summary.totalSavings },
                  { label: 'Pinjaman Outstanding', value: financialReport.summary.totalLoansOutstanding },
                  { label: 'Angsuran Diterima', value: financialReport.summary.totalPaymentsReceived },
                ].map((item) => (
                  <Card key={item.label}>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground">{item.label}</p>
                      <p className="mt-1 text-xl font-bold">{formatRupiah(item.value)}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Savings by type */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Rincian Simpanan per Jenis</CardTitle></CardHeader>
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
                      {financialReport.savingsByType.map((s, i) => (
                        <TableRow key={i}>
                          <TableCell>{s.type}</TableCell>
                          <TableCell>{s.configName}</TableCell>
                          <TableCell className="text-right">{s.accountCount}</TableCell>
                          <TableCell className="text-right font-semibold">{formatRupiah(s.totalBalance)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Savings transactions */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Rincian Transaksi Simpanan</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Periode</TableHead>
                        <TableHead className="text-right">Total Setoran</TableHead>
                        <TableHead className="text-right">Total Penarikan</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {financialReport.savingTransactions.map((t, i) => (
                        <TableRow key={i}>
                          <TableCell>{t.period}</TableCell>
                          <TableCell className="text-right text-green-700">{formatRupiah(t.totalDeposit)}</TableCell>
                          <TableCell className="text-right text-orange-700">{formatRupiah(t.totalWithdrawal)}</TableCell>
                          <TableCell className="text-right font-semibold">{formatRupiah(t.net)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Loans by type */}
              <Card>
                <CardHeader><CardTitle className="text-sm">Rincian Pinjaman</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Jenis</TableHead>
                        <TableHead className="text-right">Dicairkan</TableHead>
                        <TableHead className="text-right">Angsuran Diterima</TableHead>
                        <TableHead className="text-right">Outstanding</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {financialReport.loansByType.map((l, i) => (
                        <TableRow key={i}>
                          <TableCell>{l.configName}</TableCell>
                          <TableCell className="text-right">{formatRupiah(l.disbursed)}</TableCell>
                          <TableCell className="text-right text-green-700">{formatRupiah(l.paymentsReceived)}</TableCell>
                          <TableCell className="text-right font-semibold text-orange-700">{formatRupiah(l.outstanding)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <FileText className="h-10 w-10" />
              <p className="text-sm">Pilih periode dan klik "Tampilkan Laporan"</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="rat" className="mt-4">
          {isLoading ? (
            <PageLoading />
          ) : ratReport ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[
                { label: 'Total Aset', value: ratReport.totalAssets },
                { label: 'Total Kewajiban', value: ratReport.totalLiabilities },
                { label: 'Ekuitas', value: ratReport.equity },
                { label: 'Pendapatan', value: ratReport.income },
                { label: 'Beban', value: ratReport.expenses },
                { label: 'SHU (Laba Bersih)', value: ratReport.netIncome },
              ].map((item) => (
                <Card key={item.label}>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="mt-1 text-xl font-bold">{formatRupiah(item.value)}</p>
                  </CardContent>
                </Card>
              ))}
              <Card>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">Jumlah Anggota</p>
                  <p className="mt-1 text-xl font-bold">{ratReport.memberCount} orang</p>
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-16 text-muted-foreground">
              <FileText className="h-10 w-10" />
              <p className="text-sm">Pilih periode dan klik "Tampilkan Laporan"</p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
