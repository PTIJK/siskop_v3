import { useState } from "react";
import { Navigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Activity, TrendingUp } from "lucide-react";
import { DASHBOARD_RANGES, type DashboardRange, type PlatformDashboard } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { useAuth } from "@/stores/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AttentionPanel } from "./dashboard/AttentionPanel";
import { KpiCards } from "./dashboard/KpiCards";
import { LinePanel } from "./dashboard/LinePanel";
import { RegionPanel } from "./dashboard/RegionPanel";
import { ReferralPanel } from "./dashboard/ReferralPanel";
import { RevenuePanel } from "./dashboard/RevenuePanel";
import { bucketLabel, hasTechnicalData, RANGE_LABEL, totalRequests } from "./dashboard/dashboardView";

const C = (n: number) => `hsl(var(--chart-${n}))`;

export function PlatformDashboardPage() {
  const role = useAuth((s) => s.user?.role);
  const [range, setRange] = useState<DashboardRange>("30d");

  const { data, isPending, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["platform", "dashboard", range],
    queryFn: () => apiFetch<PlatformDashboard>(`/platform/dashboard?range=${range}`),
    placeholderData: keepPreviousData,
    enabled: role === "super_admin"
  });

  if (role !== "super_admin") return <Navigate to="/dashboard" replace />;

  const header = (
    <PageHeader
      title="Dashboard platform"
      description="Kondisi SISKOP secara keseluruhan: performa, pertumbuhan, wilayah, dan revenue"
      actions={
        <div className="flex items-center gap-2">
          <span aria-live="polite" className="text-xs text-muted-foreground">{isFetching && !isPending ? "Memperbarui…" : ""}</span>
          <div className="flex gap-1" role="group" aria-label="Rentang waktu">
            {DASHBOARD_RANGES.map((r) => (
              <Button key={r} size="sm" variant={range === r ? "default" : "outline"} aria-pressed={range === r} onClick={() => setRange(r)}>
                {RANGE_LABEL[r]}
              </Button>
            ))}
          </div>
        </div>
      }
    />
  );

  if (isError) {
    return (
      <div className="space-y-6">
        {header}
        <FormError error={error instanceof Error ? error.message : "Gagal memuat dashboard"} />
        <Button variant="outline" onClick={() => void refetch()}>Coba lagi</Button>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[300px]" />)}
        </div>
      </div>
    );
  }

  const label = <T extends { bucket: string }>(rows: T[]) => rows.map((r) => ({ ...r, label: bucketLabel(r.bucket) }));
  const technical = label(data.performance.technical).map((p) => ({
    ...p,
    errorPct: Math.round(p.errorRate * 1000) / 10
  }));

  return (
    <div className="space-y-8">
      {header}
      <KpiCards kpis={data.kpis} />

      {/* 1. Bisnis & Pertumbuhan */}
      <section aria-labelledby="section-business" className="space-y-4">
        <div className="flex items-center gap-2.5 border-b border-border pb-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <TrendingUp className="h-4 w-4" />
          </span>
          <div>
            <h2 id="section-business" className="text-base font-bold tracking-tight text-foreground">
              Bisnis &amp; Pertumbuhan
            </h2>
            <p className="text-xs text-muted-foreground">
              Pendapatan, referral, pertumbuhan koperasi &amp; anggota, persebaran wilayah, serta akun yang perlu perhatian
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <RevenuePanel revenue={data.revenue} />
          <ReferralPanel referrals={data.referrals} />
          <LinePanel
            title="Pertumbuhan koperasi dan pengguna"
            description="Koperasi baru dan pengguna staf baru"
            data={label(data.growth)}
            series={[
              { key: "tenants", name: "Koperasi baru", color: C(3) },
              { key: "users", name: "Pengguna baru", color: C(2), dashed: true }
            ]}
          />
          <LinePanel
            title="Pertumbuhan anggota"
            description={`Total anggota di seluruh koperasi: ${data.members.total.toLocaleString("id-ID")}`}
            data={label(data.members.series)}
            series={[{ key: "totalMembers", name: "Total anggota", color: C(4) }]}
          />
          <div className="lg:col-span-2">
            <RegionPanel regions={data.regions} />
          </div>
        </div>

        <AttentionPanel items={data.attention} />
      </section>

      {/* 2. IT & Performa Sistem */}
      <section aria-labelledby="section-it" className="space-y-4">
        <div className="flex items-center gap-2.5 border-b border-border pb-2.5">
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-foreground"
          >
            <Activity className="h-4 w-4" />
          </span>
          <div>
            <h2 id="section-it" className="text-base font-bold tracking-tight text-foreground">
              IT &amp; Performa Sistem
            </h2>
            <p className="text-xs text-muted-foreground">
              Aktivitas sistem, latensi p50/p95, serta tingkat error 5xx dan trafik request
            </p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <LinePanel
            title="Performa: aktivitas"
            description={`Aksi tercatat per ${range === "12m" ? "bulan" : "hari"}. Koperasi aktif: ${data.performance.activeTenants7d} (7 hari), ${data.performance.activeTenants30d} (30 hari)`}
            data={label(data.performance.activity)}
            series={[{ key: "actions", name: "Aksi tercatat", color: C(1) }]}
          />
          <LinePanel
            title="Performa: latensi"
            description="p50 dan p95 dalam milidetik (perkiraan, rata-rata berbobot dari data per jam)"
            data={technical}
            series={[
              { key: "p50Ms", name: "p50", color: C(4) },
              { key: "p95Ms", name: "p95", color: C(2), dashed: true }
            ]}
            empty={hasTechnicalData(data.performance.technical) ? undefined : "Telemetri baru mulai terkumpul sejak fitur ini dirilis."}
            formatValue={(n) => `${n} ms`}
          />
          <div className="lg:col-span-2">
            <LinePanel
              title="Performa: error dan trafik"
              description={`Persentase respons 5xx. Total request pada rentang ini: ${totalRequests(data.performance.technical).toLocaleString("id-ID")}`}
              data={technical}
              series={[{ key: "errorPct", name: "Error 5xx", color: C(5), dashed: true }]}
              empty={hasTechnicalData(data.performance.technical) ? undefined : "Telemetri baru mulai terkumpul sejak fitur ini dirilis."}
              formatValue={(n) => `${n}%`}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
