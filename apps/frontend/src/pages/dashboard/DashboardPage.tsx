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
  ReferenceLine
} from "recharts";
import { PiggyBank, CreditCard, Users, TrendingUp, Sparkles, AlertCircle, AlertTriangle, Info, CheckCircle2, Wallet, ClipboardList, Store } from "lucide-react";
import type { CapitalDashboard, DashboardSummary, GrowthPoint, LoanQualityDashboard, MemberRegistrationRequest, PasarDashboard } from "@siskop/types";
import { apiFetch, apiFetchPage, ApiRequestError } from "@/api/client";
import { formatAngkaRingkas, formatRupiah, formatRupiahRingkas } from "@/lib/format";
import { buildAiSuggestions, type SuggestionTone } from "@/lib/aiSuggestions";
import { ALL_UNITS } from "@/lib/unit";
import { useUnitScope } from "@/stores/unit-scope";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { usePermissions } from "@/hooks/usePermissions";
import { useEntitlements, useSubscription } from "@/hooks/useEntitlements";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SERIES } from "./chartColors";
import { AttentionPanel } from "./AttentionPanel";
import { buildAttentionItems } from "./attention";
import { KolDistribution } from "./KolDistribution";
import { TrendChart } from "./TrendChart";
import { ComplianceSection, HealthSection } from "./HealthSection";

const SUGGESTION_ICONS: Record<SuggestionTone, typeof AlertTriangle> = {
  danger: AlertTriangle,
  warning: AlertCircle,
  info: Info,
  success: CheckCircle2
};

const SUGGESTION_COLORS: Record<SuggestionTone, string> = {
  danger: "text-destructive",
  warning: "text-warning",
  info: "text-info",
  success: "text-success"
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
  const unitId = useUnitScope((s) => s.unitId);
  const { can } = usePermissions();
  const { isLocked } = useEntitlements();
  const subscription = useSubscription();
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
  // Koperasi pasar plan F7 — silently absent (not an EntitlementNotice) for a
  // non-pasar tenant, since Dashboard is every tenant's landing page, unlike
  // a dedicated report page where "not entitled" is informative rather than clutter.
  const pasarQuery = useQuery({
    queryKey: ["dashboard", "pasar"],
    queryFn: () => apiFetch<PasarDashboard>("/dashboard/pasar"),
    retry: (count, err) => (err instanceof ApiRequestError && err.code === "FEATURE_NOT_ENTITLED" ? false : count < 3)
  });

  // Self-registrations waiting for review; only asked for roles that can read members.
  const registrationsQuery = useQuery({
    queryKey: ["members", "registration-requests", "pending-count"],
    queryFn: () => apiFetchPage<MemberRegistrationRequest[]>("/members/registration-requests?status=PENDING&page=1&limit=1"),
    enabled: can("members", "read"),
    retry: false
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

  const attentionItems = buildAttentionItems({
    summary,
    quality: qualityQuery.data,
    capital: capitalQuery.data,
    pasar: pasarQuery.data,
    subscription: subscription.data,
    pendingRegistrations: registrationsQuery.data?.meta.total,
    canSeeLoans: can("loans", "read"),
    route: (href, feature) => (feature && isLocked(feature) ? `/langganan?fitur=${feature}` : href)
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Beranda" description="Yang perlu diputuskan hari ini, lalu ringkasan keadaan koperasi." />

      <div className="grid grid-cols-1 gap-4 min-[1181px]:grid-cols-[5fr_7fr]">
        <AttentionPanel
          items={attentionItems}
          isLoading={summaryQuery.isPending}
          isError={summaryQuery.isError}
          onRetry={() => void summaryQuery.refetch()}
        />

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2">
            <StatCard
              title="Total simpanan"
              value={summary ? formatRupiahRingkas(summary.totalSavings) : "-"}
              valueLabel={summary ? formatRupiah(summary.totalSavings) : undefined}
              subtitle={summary ? `Modal ${formatRupiahRingkas(summary.savingsEquity)} · dapat ditarik ${formatRupiahRingkas(summary.savingsLiability)}` : undefined}
              icon={PiggyBank}
              isLoading={isLoading}
              onClick={() => navigate("/savings")}
            />
            <StatCard
              title="Pinjaman aktif"
              value={summary ? formatRupiahRingkas(summary.totalActiveLoans) : "-"}
              valueLabel={summary ? formatRupiah(summary.totalActiveLoans) : undefined}
              icon={CreditCard}
              isLoading={isLoading}
              onClick={() => navigate("/loans")}
            />
            <StatCard
              title="Jumlah anggota"
              value={summary?.memberCount?.toString() ?? "-"}
              {...(summary ? memberDelta(summary) : {})}
              icon={Users}
              isLoading={isLoading}
              onClick={() => navigate("/members")}
            />
            <StatCard
              title="Angsuran bulan ini"
              value={summary ? formatRupiahRingkas(summary.monthlyPayments) : "-"}
              valueLabel={summary ? formatRupiah(summary.monthlyPayments) : undefined}
              subtitle={summary ? `Bulan lalu ${formatRupiahRingkas(summary.previous.monthlyPayments)}` : undefined}
              icon={TrendingUp}
              isLoading={isLoading}
              onClick={() => navigate("/loans")}
            />
          </div>

          <TrendChart
            title="Pencairan dan angsuran"
            description="12 bulan terakhir"
            data={growth}
            series={[
              { key: "disbursement", name: "Pencairan", color: SERIES.primary },
              { key: "repayment", name: "Angsuran", color: SERIES.secondary, dashed: true }
            ]}
          />
        </div>
      </div>

      {pasarQuery.data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            title="Setoran hari ini"
            value={formatRupiah(pasarQuery.data.setoranHariIni)}
            icon={Wallet}
            onClick={() => navigate("/reports/pasar")}
          />
          <StatCard
            title="Batch belum diverifikasi"
            value={pasarQuery.data.batchBelumDiverifikasi.toString()}
            icon={ClipboardList}
            onClick={() => navigate("/reports/pasar")}
            alert={pasarQuery.data.batchBelumDiverifikasi > 0}
          />
          <StatCard
            title="Total tunggakan pasar"
            value={formatRupiah(pasarQuery.data.totalTunggakan)}
            icon={Store}
            onClick={() => navigate("/reports/pasar")}
            alert={Number(pasarQuery.data.totalTunggakan) > 0}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 min-[1181px]:grid-cols-2">
        {qualityQuery.data ? <KolDistribution quality={qualityQuery.data} /> : <Skeleton className="h-40 rounded-[16px]" />}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-[18px] w-[18px]" aria-hidden="true" />
              Rekomendasi
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
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${SUGGESTION_COLORS[s.tone]}`} aria-hidden="true" />
                      <span className="text-sm text-muted-foreground">{s.text}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <HealthSection capital={capitalQuery.data} quality={qualityQuery.data} />
      <ComplianceSection capital={capitalQuery.data} />

      <div className="grid grid-cols-1 gap-4 min-[1181px]:grid-cols-2">
        <ChartCard title="Modal Sendiri" description="Posisi akhir bulan, 12 bulan terakhir">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={capitalTrend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={formatAngkaRingkas} tick={{ fontSize: 11 }} width={70} />
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
              <YAxis tickFormatter={formatAngkaRingkas} tick={{ fontSize: 11 }} width={70} />
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
