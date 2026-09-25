import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { Badge } from "@/components/shared/Badge";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { SavingStatementList } from "@/components/savings/SavingStatementList";

interface SavingDetail {
  id: string;
  member: { id: string; fullName: string; memberId: string };
  savingConfig: { name: string; type: string; rateType: string; rate: string };
  balance: string;
  isActive: boolean;
  createdAt: string;
}

// FR-MOB-SAV-02 (docs/06-PRD-SISKOP-Mobile-Version.md §7): same data as
// desktop's SavingDetailPage — Setor/Tarik buttons dropped (write action,
// out of scope). Transaction ledger rendered as cards, not the raw <Table>
// desktop uses, per docs/06 §8.1's systemic table-overflow fix (the
// "Catatan" free-text column was specifically flagged as an overflow risk).
export function SavingDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: saving, isPending } = useQuery({
    queryKey: ["savings", id],
    queryFn: () => apiFetch<SavingDetail>(`/savings/${id}`)
  });

  if (isPending) return <PageLoading />;
  if (!saving) return <p className="text-center text-sm text-muted-foreground">Rekening tidak ditemukan</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{saving.savingConfig.name}</h1>
        <p className="text-sm text-muted-foreground">
          {saving.member.fullName} — {saving.member.memberId}
        </p>
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

      <SavingStatementList basePath={`/savings/${saving.id}`} queryKey={["savings", saving.id]} fetchStatement={apiFetch} />
    </div>
  );
}
