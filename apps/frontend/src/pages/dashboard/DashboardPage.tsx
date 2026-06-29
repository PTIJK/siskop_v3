import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { PiggyBank, CreditCard, Users, TrendingUp, AlertTriangle } from 'lucide-react';
import api from '../../lib/api';
import { formatRupiah, formatRupiahSingkat } from '../../lib/utils';
import { PageHeader } from '../../components/shared/PageHeader';
import { StatCard } from '../../components/shared/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';

interface DashboardSummary {
  totalSavings: string;
  totalActiveLoans: string;
  memberCount: number;
  monthlyPayments: string;
  overdueCount: number;
}

interface ChartPoint {
  month: string;
  value: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{formatRupiah(payload[0].value)}</p>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [loanChart, setLoanChart] = useState<ChartPoint[]>([]);
  const [paymentChart, setPaymentChart] = useState<ChartPoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/api/tenant/dashboard/summary'),
      api.get('/api/tenant/dashboard/loan-chart?months=12'),
      api.get('/api/tenant/dashboard/payment-chart?months=12'),
    ])
      .then(([summaryRes, loanRes, paymentRes]) => {
        setSummary(summaryRes.data.data);
        setLoanChart(loanRes.data.data);
        setPaymentChart(paymentRes.data.data);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const loanChartData = loanChart.map((d) => ({ ...d, value: parseFloat(d.value) }));
  const paymentChartData = paymentChart.map((d) => ({ ...d, value: parseFloat(d.value) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Ringkasan operasional koperasi" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Simpanan"
          value={summary ? formatRupiah(summary.totalSavings) : '-'}
          icon={PiggyBank}
          iconColor="text-blue-600"
          isLoading={isLoading}
          onClick={() => navigate('/savings')}
        />
        <StatCard
          title="Total Pinjaman Aktif"
          value={summary ? formatRupiah(summary.totalActiveLoans) : '-'}
          icon={CreditCard}
          iconColor="text-purple-600"
          isLoading={isLoading}
          onClick={() => navigate('/loans')}
        />
        <StatCard
          title="Jumlah Anggota"
          value={summary?.memberCount?.toString() ?? '-'}
          icon={Users}
          iconColor="text-green-600"
          isLoading={isLoading}
          onClick={() => navigate('/members')}
        />
        <StatCard
          title="Angsuran Bulan Ini"
          value={summary ? formatRupiah(summary.monthlyPayments) : '-'}
          icon={TrendingUp}
          iconColor="text-teal-600"
          isLoading={isLoading}
          onClick={() => navigate('/loans')}
        />
        <StatCard
          title="Anggota Menunggak (MACET)"
          value={summary?.overdueCount?.toString() ?? '-'}
          icon={AlertTriangle}
          iconColor="text-red-600"
          isLoading={isLoading}
          onClick={() => navigate('/loans/overdue')}
          alert={(summary?.overdueCount ?? 0) > 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pencairan Pinjaman per Bulan</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={loanChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatRupiahSingkat(v)} tick={{ fontSize: 11 }} width={70} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Pencairan" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pembayaran Cicilan per Bulan</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={paymentChartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatRupiahSingkat(v)} tick={{ fontSize: 11 }} width={70} />
                <Tooltip content={<CustomTooltip />} />
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  activeDot={{ r: 5 }}
                  name="Pembayaran"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
