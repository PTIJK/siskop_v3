import { useState } from "react";
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
  Tooltip,
  Legend,
  ReferenceLine
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
import type { CapitalDashboard, DashboardSummary, GrowthPoint, LoanQualityDashboard } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { formatRupiah, formatRupiahSingkat } from "@/lib/format";
import { buildAiSuggestions, type SuggestionTone } from "@/lib/aiSuggestions";
import { ALL_UNITS } from "@/lib/unit";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { UnitFilter } from "@/components/shared/UnitFilter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SERIES } from "./chartColors";
import { ComplianceSection, HealthSection } from "./HealthSection";

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

type ValueFormat = "rupiah" | "count";

function ChartTooltip({
  active,
  payload,
  label,
  format = "rupiah"
}: {
  active?: boolean;
  payload?: { name?: string; value: number; color?: string }[];
  label?: string;
  format?: ValueFormat;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background px-3 py-2 shadow-md">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5 text-sm font-bold">
          {payload.length > 1 && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />}
          {payload.length > 1 && <span className="font-normal text-muted-foreground">{p.name}:</span>}
          {format === "rupiah" ? formatRupiah(p.value) : p.value.toLocaleString("id-ID")}
        </p>
      ))}
    </div>
  );
}

function ChartCard({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** "+2 dari bulan lalu" with a trend arrow, or nothing when unchanged. */
function memberDelta(summary: DashboardSummary): { subtitle?: string; trend?: "up" | "down" } {
  const delta = summary.memberCount - summary.previous.memberCount;
  if (delta === 0) return {};
  return { subtitle: `${delta > 0 ? "+" : ""}${delta} dari bulan lalu`, trend: delta > 0 ? "up" : "down" };
}

export function DashboardPage() {
  const navigate = useNavigate();
  const [unitId, setUnitId] = useState(ALL_UNITS);
  const unitQuery = unitId === ALL_UNITS ? "" : `?unitId=${encodeURIComponent(unitId)}`;

  const summaryQuery = useQuery({
    queryKey: ["dashboard", "summary", unitId],
    queryFn: () => apiFetch<DashboardSummary>(`/dashboard/summary${unitQuery}`)
  });
  const growthQuery = useQuery({
    queryKey: ["dashboard", "growth", unitId],
    queryFn: () => apiFetch<GrowthPoint[]>(`/dashboard/growth${unitQuery}`)
  });
  const capitalQuery = useQuery({
    queryKey: ["dashboard", "capital", unitId],
    queryFn: () => apiFetch<CapitalDashboard>(`/dashboard/capital${unitQuery}`)
  });
  const qualityQuery = useQuery({
    queryKey: ["dashboard", "loan-quality", unitId],
    queryFn: () => apiFetch<LoanQualityDashboard>(`/dashboard/loan-quality${unitQuery}`)
  });

  const summary = summaryQuery.data;
  const isLoading = summaryQuery.isPending;
  const growth = (growthQuery.data ?? []).map((g) => ({
    month: g.month,
    disbursement: parseFloat(g.disbursement),
    repayment: parseFloat(g.repayment),
    savingsNetFlow: parseFloat(g.savingsNetFlow),
    newMembers: g.newMembers
  }));
  const capitalTrend = (capitalQuery.data?.trend ?? []).map((p) => ({ month: p.month, value: parseFloat(p.value) }));

  // The capital / loan-quality rules join in once their data arrives; the
  // original summary-and-trend rules never wait for them.
  const suggestionsLoading = summaryQuery.isPending || growthQuery.isPending;
  const suggestions = buildAiSuggestions(
    summary,
    growth.map((g) => ({ month: g.month, value: g.disbursement })),
    growth.map((g) => ({ month: g.month, value: g.repayment })),
    { capital: capitalQuery.data, loanQuality: qualityQuery.data }
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title="Dashboard" description="Ringkasan operasional dan kesehatan koperasi" />
        <UnitFilter value={unitId} onChange={setUnitId} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Total Simpanan"
          value={summary ? formatRupiah(summary.totalSavings) : "-"}
          subtitle={
            summary
              ? `Modal (pokok+wajib) ${formatRupiahSingkat(summary.savingsEquity)} · dapat ditarik ${formatRupiahSingkat(summary.savingsLiability)}`
              : undefined
          }
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
          {...(summary ? memberDelta(summary) : {})}
          icon={Users}
          iconColor="text-green-600"
          isLoading={isLoading}
          onClick={() => navigate("/members")}
        />
        <StatCard
          title="Angsuran Bulan Ini"
          value={summary ? formatRupiah(summary.monthlyPayments) : "-"}
          subtitle={summary ? `Bulan lalu: ${formatRupiahSingkat(summary.previous.monthlyPayments)}` : undefined}
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Rekomendasi AI
          </CardTitle>
        </CardHeader>
        <CardContent>
          {suggestionsLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : (
            <ul className="space-y-3">
              {suggestions.map((s) => {
                const Icon = SUGGESTION_ICONS[s.tone];
                return (
                  <li key={s.id} className="flex items-start gap-2.5">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${SUGGESTION_COLORS[s.tone]}`} />
                    <span className="text-sm text-muted-foreground">{s.text}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <HealthSection capital={capitalQuery.data} quality={qualityQuery.data} />
      <ComplianceSection capital={capitalQuery.data} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ChartCard title="Pencairan vs Angsuran per Bulan" description="12 bulan terakhir">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={growth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => formatRupiahSingkat(v)} tick={{ fontSize: 11 }} width={70} />
              <Tooltip content={<ChartTooltip />} cursor={{ fillOpacity: 0.3 }} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="disbursement" name="Pencairan" fill={SERIES.primary} radius={[4, 4, 0, 0]} />
              <Bar dataKey="repayment" name="Angsuran" fill={SERIES.secondary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Modal Sendiri" description="Posisi akhir bulan, 12 bulan terakhir">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={capitalTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => formatRupiahSingkat(v)} tick={{ fontSize: 11 }} width={70} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="value" name="Modal Sendiri" stroke={SERIES.primary} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Arus Bersih Simpanan" description="Setoran dan bunga dikurangi penarikan, per bulan">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={growth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => formatRupiahSingkat(v)} tick={{ fontSize: 11 }} width={70} />
              <Tooltip content={<ChartTooltip />} cursor={{ fillOpacity: 0.3 }} />
              <ReferenceLine y={0} className="stroke-muted-foreground" />
              <Bar dataKey="savingsNetFlow" name="Arus bersih" fill={SERIES.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Anggota Baru per Bulan" description="12 bulan terakhir">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={growth} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={40} />
              <Tooltip content={<ChartTooltip format="count" />} cursor={{ fillOpacity: 0.3 }} />
              <Bar dataKey="newMembers" name="Anggota baru" fill={SERIES.primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  );
}
