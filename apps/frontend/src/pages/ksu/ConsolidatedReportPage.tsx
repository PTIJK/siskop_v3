import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/api/client";
import { getConsolidatedReport } from "@/api/ksu";
import { formatRupiah } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet } from "lucide-react";

// Read-only, journal-derived report (apps/backend/src/modules/ksu/service.ts
// #getConsolidatedAssets) — same "accounting" entitlement gate as the Neraca
// regulatory report, so a tenant without that package module gets
// FEATURE_NOT_ENTITLED, handled the same way pages/config/ShuConfigTab.tsx
// and AccountsTab.tsx already do: skip retrying that error and show
// EntitlementNotice instead of a broken/blank report.
export function ConsolidatedReportPage() {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["ksu", "consolidated"],
    queryFn: getConsolidatedReport,
    retry: (failureCount, err) => (err instanceof ApiRequestError && err.code === "FEATURE_NOT_ENTITLED" ? false : failureCount < 3)
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Laporan Konsolidasi" description="Total aset gabungan seluruh unit usaha koperasi" />

      {isPending ? (
        <PageLoading />
      ) : isError ? (
        error instanceof ApiRequestError && error.code === "FEATURE_NOT_ENTITLED" ? (
          <EntitlementNotice message={error.message} />
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {error instanceof ApiRequestError ? error.message : "Gagal memuat laporan konsolidasi"}
            </CardContent>
          </Card>
        )
      ) : (
        <>
          <Card>
            <CardContent className="flex items-center gap-4 p-6">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Wallet className="h-6 w-6 text-primary" />
              </div>
              <div>
                <p className="text-sm uppercase tracking-wide text-muted-foreground">Total Aset (Konsolidasi)</p>
                <p className="mt-1 text-3xl font-semibold text-primary">{formatRupiah(data.totalAssets)}</p>
              </div>
            </CardContent>
          </Card>

          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Rincian per Unit</h2>
            {data.byUnit.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Belum ada unit usaha aktif</p>
            ) : (
              <div className="mt-3 grid gap-3">
                {data.byUnit.map((u) => (
                  <Card key={u.unitId}>
                    <CardContent className="flex items-center justify-between p-4">
                      <span className="font-medium text-foreground">{u.unitName}</span>
                      <span className="font-semibold text-foreground">{formatRupiah(u.assets)}</span>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
