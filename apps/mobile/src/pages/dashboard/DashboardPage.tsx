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
import {
  PiggyBank,
  CreditCard,
  Users,
  TrendingUp,
  AlertTriangle,
  Sparkles,
  AlertCircle,
  Info,
  CheckCircle2
} from "lucide-react";
import type { ChartPoint, DashboardSummary } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { formatRupiah, formatRupiahSingkat } from "@/lib/format";
import { buildAiSuggestions, type SuggestionTone } from "@/lib/aiSuggestions";
import { StatCard } from "@/components/shared/StatCard";

// Full parity with apps/frontend's DashboardPage.tsx (FR-MOB-DASH-01/02/03,
// docs/06-PRD-SISKOP-Mobile-Version.md §7/§8.5) — stat cards, both charts,
// and the Rekomendasi AI card. Everything here is read-only display; no
// write action exists on desktop's Dashboard either, so nothing was excluded
// on that basis (unlike Members/Savings/Loans, which do drop write actions).

const SUGGESTION_ICONS: Record<SuggestionTone, typeof AlertTriangle> = {
  danger: AlertTriangle,
  warning: AlertCircle,
  info: Info,
  success: CheckCircle2
};

const SUGGESTION_COLORS: Record<SuggestionTone, string> = {
  danger: "text-red-600",
  warning: "text-amber-600",
  info: "text-blue-600",
  success: "text-green-600"
};

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background px-2.5 py-1.5 shadow-md">
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
  const suggestionsLoading = summaryQuery.isPending || loanChartQuery.isPending || paymentChartQuery.isPending;
  const suggestions = buildAiSuggestions(summary, loanChartData, paymentChartData);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">Ringkasan operasional koperasi</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          title="Total Simpanan"
          value={summary ? formatRupiahSingkat(summary.totalSavings) : "-"}
          icon={PiggyBank}
          isLoading={isLoading}
          onClick={() => navigate("/savings")}
        />
        <StatCard
          title="Pinjaman Aktif"
          value={summary ? formatRupiahSingkat(summary.totalActiveLoans) : "-"}
          icon={CreditCard}
          isLoading={isLoading}
          onClick={() => navigate("/loans")}
        />
        <StatCard
          title="Jumlah Anggota"
          value={summary?.memberCount?.toString() ?? "-"}
          icon={Users}
          isLoading={isLoading}
          onClick={() => navigate("/members")}
        />
        <StatCard
          title="Angsuran Bulan Ini"
          value={summary ? formatRupiahSingkat(summary.monthlyPayments) : "-"}
          icon={TrendingUp}
          isLoading={isLoading}
          onClick={() => navigate("/loans")}
        />
        <StatCard
          title="Menunggak (MACET)"
          value={summary?.overdueCount?.toString() ?? "-"}
          icon={AlertTriangle}
          isLoading={isLoading}
          alert={(summary?.overdueCount ?? 0) > 0}
          onClick={() => navigate("/loans/overdue")}
        />
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Rekomendasi AI</h2>
        </div>
        {suggestionsLoading ? (
          <div className="space-y-2">
            <div className="h-3.5 w-full animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-4/5 animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <ul className="space-y-2.5">
            {suggestions.map((s) => {
              const Icon = SUGGESTION_ICONS[s.tone];
              return (
                <li key={s.id} className="flex items-start gap-2">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${SUGGESTION_COLORS[s.tone]}`} />
                  <span className="text-xs text-muted-foreground">{s.text}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Pencairan Pinjaman per Bulan</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={loanChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v) => formatRupiahSingkat(v)} tick={{ fontSize: 10 }} width={52} />
            {/* recharts' default Tooltip generally responds to tap on mobile
                browsers (touch translates to a synthetic mouseover on the SVG
                target) — real-device verification is still pending per
                docs/06-PRD-SISKOP-Mobile-Version.md §8.4, not assumed here. */}
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="value" fill="#3b82f6" radius={[3, 3, 0, 0]} name="Pencairan" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-sm font-semibold">Pembayaran Cicilan per Bulan</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={paymentChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis dataKey="month" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={(v) => formatRupiahSingkat(v)} tick={{ fontSize: 10 }} width={52} />
            {/* recharts' default Tooltip generally responds to tap on mobile
                browsers (touch translates to a synthetic mouseover on the SVG
                target) — real-device verification is still pending per
                docs/06-PRD-SISKOP-Mobile-Version.md §8.4, not assumed here. */}
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 4 }} name="Pembayaran" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {summaryQuery.isError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Gagal memuat ringkasan dashboard.
        </p>
      )}
    </div>
  );
}
