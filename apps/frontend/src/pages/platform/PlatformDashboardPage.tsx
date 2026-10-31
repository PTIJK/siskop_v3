import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import { RevenuePanel } from "./dashboard/RevenuePanel";
import { bucketLabel, hasTechnicalData, RANGE_LABEL } from "./dashboard/dashboardView";

const C = (n: number) => `hsl(var(--chart-${n}))`;

export function PlatformDashboardPage() {
  const role = useAuth((s) => s.user?.role);
  const [range, setRange] = useState<DashboardRange>("30d");

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["platform", "dashboard", range],
    queryFn: () => apiFetch<PlatformDashboard>(`/platform/dashboard?range=${range}`)
  });

  if (role !== "super_admin") return <Navigate to="/dashboard" replace />;

  const header = (
    <PageHeader
      title="Dashboard platform"
      description="Kondisi SISKOP secara keseluruhan: performa, pertumbuhan, wilayah, dan revenue"
      actions={
        <div className="flex gap-1" role="group" aria-label="Rentang waktu">
          {DASHBOARD_RANGES.map((r) => (
            <Button key={r} size="sm" variant={range === r ? "default" : "outline"} aria-pressed={range === r} onClick={() => setRange(r)}>
              {RANGE_LABEL[r]}
            </Button>
          ))}
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
    <div className="space-y-6">
      {header}
      <KpiCards kpis={data.kpis} />

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
        <RegionPanel regions={data.regions} />
        <RevenuePanel revenue={data.revenue} />
      </div>

      <AttentionPanel items={data.attention} />
    </div>
  );
}
