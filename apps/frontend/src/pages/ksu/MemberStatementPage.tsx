import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ApiRequestError } from "@/api/client";
import { getMemberStatement } from "@/api/ksu";
import { formatRupiah } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { EntitlementNotice } from "@/components/shared/EntitlementNotice";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet } from "lucide-react";

// Read-only, per-member per-unit SHU breakdown
// (apps/backend/src/modules/ksu/service.ts#getMemberUnitStatement) — same
// "accounting" entitlement + reports:read gate as /ksu/consolidated
// (backend routes.ts), so a tenant without that package module gets
// FEATURE_NOT_ENTITLED, handled the same way ConsolidatedReportPage.tsx
// (and pages/config/ShuConfigTab.tsx / AccountsTab.tsx) already do: skip
// retrying that error and show EntitlementNotice instead of a broken page.
//
// Same layout family as ConsolidatedReportPage.tsx: a summary total card
// (here, the member's SHU summed across units — the API itself returns only
// the per-unit breakdown, no aggregate field) followed by a per-unit card
// list.
export function MemberStatementPage() {
  const { memberId } = useParams<{ memberId: string }>();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["ksu", "member-statement", memberId],
    queryFn: () => getMemberStatement(memberId as string),
    enabled: Boolean(memberId),
    retry: (failureCount, err) => (err instanceof ApiRequestError && err.code === "FEATURE_NOT_ENTITLED" ? false : failureCount < 3)
  });

  const totalShu = data?.units.reduce((sum, u) => sum + u.shu, 0) ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="Laporan SHU Anggota" description="Rincian Sisa Hasil Usaha (SHU) anggota per unit usaha" />

      {!memberId ? (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">Anggota tidak ditemukan</CardContent>
        </Card>
      ) : isPending ? (
        <PageLoading />
      ) : isError ? (
        error instanceof ApiRequestError && error.code === "FEATURE_NOT_ENTITLED" ? (
          <EntitlementNotice message={error.message} />
        ) : (
          <Card>
            <CardContent className="py-6 text-sm text-destructive">
              {error instanceof ApiRequestError ? error.message : "Gagal memuat laporan SHU anggota"}
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
                <p className="text-sm uppercase tracking-wide text-muted-foreground">Total SHU (Seluruh Unit)</p>
                <p className="mt-1 text-3xl font-semibold text-primary">{formatRupiah(totalShu)}</p>
              </div>
            </CardContent>
          </Card>

          <div>
            <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Rincian per Unit</h2>
            {data.units.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Anggota belum memiliki aktivitas di unit usaha manapun</p>
            ) : (
              <div className="mt-3 grid gap-3">
                {data.units.map((u) => (
                  <Card key={u.unitId}>
                    <CardContent className="flex items-center justify-between p-4">
                      <span className="font-medium text-foreground">{u.unitName}</span>
                      <span className="font-semibold text-foreground">{formatRupiah(u.shu)}</span>
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
