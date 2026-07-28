import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from "recharts";
import { PiggyBank, CreditCard, Users, TrendingUp, AlertTriangle } from "lucide-react";
import type { ChartPoint, DashboardSummary } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { formatRupiah, formatRupiahSingkat } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function CustomTooltip({
  active,
  payload,
  label
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{formatRupiah(payload[0]?.value ?? 0)}</p>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();

  const summaryQuery = useQuery({
    queryKey: ["dashboard", "summary"],
    queryFn: () => apiFetch<DashboardSummary>("/dashboard/summary")
  });
  const loanChartQuery = useQuery({
    queryKey: ["dashboard", "loan-chart"],
    queryFn: () => apiFetch<ChartPoint[]>("/dashboard/loan-chart?months=12")
  });
  const paymentChartQuery = useQuery({
    queryKey: ["dashboard", "payment-chart"],
    queryFn: () => apiFetch<ChartPoint[]>("/dashboard/payment-chart?months=12")
  });

  const summary = summaryQuery.data;
  const isLoading = summaryQuery.isPending;
  const loanChartData = (loanChartQuery.data ?? []).map((d) => ({ ...d, value: parseFloat(d.value) }));
  const paymentChartData = (paymentChartQuery.data ?? []).map((d) => ({ ...d, value: parseFloat(d.value) }));

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Ringkasan operasional koperasi" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Simpanan"
          value={summary ? formatRupiah(summary.totalSavings) : "-"}
          icon={PiggyBank}
          iconColor="text-blue-600"
          isLoading={isLoading}
          onClick={() => navigate("/savings")}
        />
        <StatCard
          title="Total Pinjaman Aktif"
          value={summary ? formatRupiah(summary.totalActiveLoans) : "-"}
          icon={CreditCard}
          iconColor="text-purple-600"
          isLoading={isLoading}
          onClick={() => navigate("/loans")}
        />
        <StatCard
          title="Jumlah Anggota"
          value={summary?.memberCount?.toString() ?? "-"}
          icon={Users}
          iconColor="text-green-600"
          isLoading={isLoading}
          onClick={() => navigate("/members")}
        />
        <StatCard
          title="Angsuran Bulan Ini"
          value={summary ? formatRupiah(summary.monthlyPayments) : "-"}
          icon={TrendingUp}
          iconColor="text-teal-600"
          isLoading={isLoading}
          onClick={() => navigate("/loans")}
        />
        <StatCard
          title="Anggota Menunggak (MACET)"
          value={summary?.overdueCount?.toString() ?? "-"}
          icon={AlertTriangle}
          iconColor="text-red-600"
          isLoading={isLoading}
          onClick={() => navigate("/loans/overdue")}
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
