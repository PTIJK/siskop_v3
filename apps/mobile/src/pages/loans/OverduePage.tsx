import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import type { KOLCategory } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { formatRupiahSingkat, formatTanggalPendek } from "@/lib/format";
import { CardList } from "@/components/shared/CardList";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { cn } from "@/lib/utils";

interface OverdueLoan {
  id: string;
  member: { fullName: string; memberId: string };
  loanConfig: { name: string };
  remainingAmount: string;
  kolCategory: string;
  daysOverdue: number;
  lastPaymentAt?: string | null;
}

const KOL_ORDER: KOLCategory[] = ["MACET", "DIRAGUKAN", "KURANG_LANCAR", "DALAM_PERHATIAN"];

// Same severity-tint mapping as desktop's ROW_TINT (OverduePage.tsx:25-28,
// docs/06 §8.2 — explicitly flagged as "functionally important, must be
// preserved in any card-list redesign, not dropped as just styling").
const TINT: Record<string, string> = {
  MACET: "bg-red-50",
  DIRAGUKAN: "bg-orange-50"
};

// FR-MOB-LOAN-03 (docs/06-PRD-SISKOP-Mobile-Version.md §7): same data +
// severity sort + row tinting as desktop's OverduePage.
export function OverduePage() {
  const navigate = useNavigate();

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["loans", "overdue"],
    queryFn: async () => {
      const items = await apiFetch<OverdueLoan[]>("/loans/overdue");
      return [...items].sort(
        (a, b) => KOL_ORDER.indexOf(a.kolCategory as KOLCategory) - KOL_ORDER.indexOf(b.kolCategory as KOLCategory)
      );
    }
  });
  const rows = data ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Anggota Menunggak</h1>
        <p className="text-sm text-muted-foreground">Pinjaman dengan status bermasalah (non-LANCAR)</p>
      </div>

      {rows.length > 0 && (
        <div className="flex items-center gap-2.5 rounded-lg border border-red-300 bg-red-50 px-3 py-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" />
          <p className="text-xs font-medium text-red-800">{rows.length} pinjaman memerlukan perhatian segera</p>
        </div>
      )}

      <CardList
        items={rows}
        keyExtractor={(l) => l.id}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        onItemClick={(l) => navigate(`/loans/${l.id}`)}
        emptyMessage="Tidak ada pinjaman bermasalah"
        renderCard={(l) => (
          <div className={cn("-m-3 rounded-lg p-3", TINT[l.kolCategory])}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.member.fullName}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{l.member.memberId}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{l.loanConfig.name}</p>
              </div>
              <KOLBadge category={l.kolCategory} className="shrink-0" />
            </div>
            <div className="mt-2 flex items-end justify-between border-t border-black/5 pt-2 text-xs">
              <div>
                <p className="text-muted-foreground">Sisa Pinjaman</p>
                <p className="font-semibold">{formatRupiahSingkat(l.remainingAmount)}</p>
              </div>
              <div className="text-right">
                <p className={cn("font-semibold", l.daysOverdue > 180 ? "text-red-600" : "text-orange-600")}>
                  {l.daysOverdue} hari terlambat
                </p>
                <p className="text-muted-foreground">
                  {l.lastPaymentAt ? `Bayar terakhir ${formatTanggalPendek(l.lastPaymentAt)}` : "Belum pernah bayar"}
                </p>
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
