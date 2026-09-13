import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownCircle, ArrowUpCircle, TrendingUp } from "lucide-react";
import type { SavingTransaction } from "@siskop/types";
import { apiFetch, apiFetchPage } from "@/api/client";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { Badge } from "@/components/shared/Badge";
import { PageLoading } from "@/components/shared/LoadingSpinner";

interface SavingDetail {
  id: string;
  member: { id: string; fullName: string; memberId: string };
  savingConfig: { name: string; type: string; rateType: string; rate: string };
  balance: string;
  isActive: boolean;
  createdAt: string;
}

interface TransactionRow extends SavingTransaction {
  createdByUser: { name: string } | null;
}

const LIMIT = 20;

const TRANSACTION_TYPE_META: Record<TransactionRow["type"], { label: string; icon: typeof ArrowDownCircle; colorClass: string; sign: "+" | "-" }> = {
  DEPOSIT: { label: "Setoran", icon: ArrowDownCircle, colorClass: "text-green-600", sign: "+" },
  INTEREST: { label: "Bunga", icon: TrendingUp, colorClass: "text-blue-600", sign: "+" },
  WITHDRAWAL: { label: "Penarikan", icon: ArrowUpCircle, colorClass: "text-orange-600", sign: "-" }
};

// FR-MOB-SAV-02 (docs/06-PRD-SISKOP-Mobile-Version.md §7): same data as
// desktop's SavingDetailPage — Setor/Tarik buttons dropped (write action,
// out of scope). Transaction ledger rendered as cards, not the raw <Table>
// desktop uses, per docs/06 §8.1's systemic table-overflow fix (the
// "Catatan" free-text column was specifically flagged as an overflow risk).
export function SavingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [page, setPage] = useState(1);

  const { data: saving, isPending } = useQuery({
    queryKey: ["savings", id],
    queryFn: () => apiFetch<SavingDetail>(`/savings/${id}`)
  });
  const { data: transactionsPage } = useQuery({
    queryKey: ["savings", id, "transactions", page],
    queryFn: () => apiFetchPage<TransactionRow[]>(`/savings/${id}/transactions?page=${page}&limit=${LIMIT}`)
  });
  const transactions = transactionsPage?.items ?? [];
  const total = transactionsPage?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / LIMIT);

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

      <div>
        <h2 className="mb-2 text-sm font-semibold">Riwayat Transaksi</h2>
        {transactions.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border py-8 text-center text-muted-foreground">
            <p className="text-sm">Belum ada transaksi</p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map((t) => {
              const meta = TRANSACTION_TYPE_META[t.type];
              const Icon = meta.icon;
              return (
                <div key={t.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${meta.colorClass}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium">{meta.label}</span>
                          <span className="text-xs text-muted-foreground">{formatTanggalPendek(t.createdAt)}</span>
                        </div>
                        {t.note && <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.note}</p>}
                        <p className="mt-0.5 text-xs text-muted-foreground">{t.createdByUser?.name ?? "Sistem"}</p>
                      </div>
                    </div>
                    <p className={`shrink-0 text-sm font-semibold ${meta.sign === "+" ? "text-green-700" : "text-orange-700"}`}>
                      {meta.sign}
                      {formatRupiah(t.amount)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border px-2 py-1 disabled:opacity-40"
            >
              Sebelumnya
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border px-2 py-1 disabled:opacity-40"
            >
              Berikutnya
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
