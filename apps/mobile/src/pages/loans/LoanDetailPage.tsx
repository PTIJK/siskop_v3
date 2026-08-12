import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/api/client";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { Badge } from "@/components/shared/Badge";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { PageLoading } from "@/components/shared/LoadingSpinner";

interface LoanDetail {
  id: string;
  member: { id: string; fullName: string; memberId: string; accountNumber: string };
  loanConfig: { name: string; type: string; rateType: string; rate: string };
  principalAmount: string;
  totalAmount: string;
  monthlyPayment: string;
  remainingAmount: string;
  termMonths: number;
  status: string;
  kolCategory: string;
  disbursedAt?: string;
  payments: {
    id: string;
    amount: string;
    penalty: string;
    note?: string;
    paidAt: string;
    createdByUser?: { name: string };
  }[];
}

// FR-MOB-LOAN-02 (docs/06-PRD-SISKOP-Mobile-Version.md §7): same data as
// desktop's LoanDetailPage, including the paid/remaining progress indicator
// that the original terse FR wording didn't name explicitly (§12 item 7) —
// "Catat Pembayaran" dropped (write action). Pokok/Total/Angsuran stacked
// vertically instead of desktop's unresponsive `grid-cols-3` (LoanDetailPage.tsx:121,
// flagged in the UI audit, docs/06 §8.1) — a deliberate improvement, not a
// missed port. Payment history rendered as cards, not the raw <Table> with an
// unbounded "Catatan" column (same systemic fix as Savings).
export function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: loan, isPending } = useQuery({
    queryKey: ["loans", id],
    queryFn: () => apiFetch<LoanDetail>(`/loans/${id}`)
  });

  if (isPending) return <PageLoading />;
  if (!loan) return <p className="text-center text-sm text-muted-foreground">Pinjaman tidak ditemukan</p>;

  const total = parseFloat(loan.totalAmount);
  const remaining = parseFloat(loan.remainingAmount);
  const paid = total - remaining;
  const progress = total > 0 ? Math.round((paid / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{loan.member.fullName}</h1>
        <p className="font-mono text-xs text-muted-foreground">{loan.member.memberId}</p>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="flex flex-wrap gap-1.5">
          <Badge>{loan.loanConfig.name}</Badge>
          <Badge variant="outline">{loan.status}</Badge>
          <KOLBadge category={loan.kolCategory} />
        </div>
        {loan.disbursedAt && (
          <p className="mt-2 text-xs text-muted-foreground">Cair: {formatTanggalPendek(loan.disbursedAt)}</p>
        )}

        <dl className="mt-3 space-y-1.5 border-t pt-3">
          {[
            { label: "Pokok", value: formatRupiah(loan.principalAmount) },
            { label: "Total", value: formatRupiah(loan.totalAmount) },
            { label: "Angsuran/bln", value: formatRupiah(loan.monthlyPayment) }
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between text-sm">
              <dt className="text-muted-foreground">{item.label}</dt>
              <dd className="font-semibold">{item.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-3 border-t pt-3">
          <div className="mb-1 flex justify-between text-xs">
            <span>Dibayar: {formatRupiah(paid)}</span>
            <span className="text-orange-600">Sisa: {formatRupiah(remaining)}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
          </div>
          <p className="mt-0.5 text-right text-xs text-muted-foreground">{progress}% lunas</p>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Riwayat Pembayaran</h2>
        {loan.payments.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border py-8 text-center text-muted-foreground">
            <p className="text-sm">Belum ada riwayat pembayaran</p>
          </div>
        ) : (
          <div className="space-y-2">
            {loan.payments.map((p) => (
              <div key={p.id} className="rounded-lg border bg-card p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{formatTanggalPendek(p.paidAt)}</p>
                    {p.note && <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.note}</p>}
                    <p className="mt-0.5 text-xs text-muted-foreground">{p.createdByUser?.name ?? "-"}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-green-700">{formatRupiah(p.amount)}</p>
                    {parseFloat(p.penalty) > 0 && (
                      <p className="text-xs text-red-600">Denda {formatRupiah(p.penalty)}</p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
