import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { memberApiFetch } from "@/api/memberClient";
import { getMemberAccessToken } from "@/stores/memberAuth";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { Badge } from "@/components/shared/Badge";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { SavingStatementList } from "@/components/savings/SavingStatementList";

interface MySavingDetail {
  id: string;
  savingConfig: { name: string; type: string; rateType: string; rate: string };
  balance: string;
  isActive: boolean;
  createdAt: string;
}

// Same read-only shape as staff pages/savings/SavingDetailPage.tsx, pointed
// at the member-scoped endpoint (ownership already enforced server-side).
export function MemberSavingDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: saving, isPending } = useQuery({
    queryKey: ["member", "savings", id],
    queryFn: () => memberApiFetch<MySavingDetail>(`/member/savings/${id}`)
  });

  if (isPending) return <PageLoading />;
  if (!saving) return <p className="text-center text-sm text-muted-foreground">Rekening tidak ditemukan</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{saving.savingConfig.name}</h1>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{saving.savingConfig.type}</Badge>
          <Badge variant="outline">
            {saving.savingConfig.rateType} {saving.savingConfig.rate}%
          </Badge>
        </div>
        <div className="mt-3">
          <p className="text-xs text-muted-foreground">Saldo</p>
          <p className="text-2xl font-bold text-primary">{formatRupiah(saving.balance)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Sejak {formatTanggalPendek(saving.createdAt)}</p>
        </div>
      </div>

      <SavingStatementList
        basePath={`/member/savings/${saving.id}`}
        queryKey={["member", "savings", saving.id]}
        fetchStatement={memberApiFetch}
        getToken={getMemberAccessToken}
      />
    </div>
  );
}
