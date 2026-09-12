import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MemberCreditSummary } from "@siskop/types";
import { listOutstandingCredit } from "@/api/konsumen";
import { formatRupiah } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { CreditRepaymentDialog } from "@/components/konsumen/CreditRepaymentDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Receipt, Store, Users } from "lucide-react";

const LIMIT = 20;

/**
 * Tenant-wide "Piutang Anggota" (Kredit Toko receivables) — one row per
 * member, mirroring LoansDashboardPage's list+action shape but for store
 * credit instead of loans. Repayment reuses CreditRepaymentDialog, the same
 * component MemberDetailPage's "Kredit Toko" tab uses, so there is exactly
 * one repayment flow in the app regardless of where it's opened from.
 */
export function PiutangAnggotaPage() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [repayTarget, setRepayTarget] = useState<MemberCreditSummary | null>(null);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["konsumen", "credit", "outstanding", { page, search }],
    queryFn: () => listOutstandingCredit({ page, limit: LIMIT, search: search || undefined })
  });

  const totalOutstanding = data?.meta.totalOutstanding ?? "0";
  const memberCount = data?.meta.total ?? 0;

  const columns: ColumnDef<MemberCreditSummary>[] = [
    {
      header: "Anggota",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.fullName}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.original.memberNumber}</p>
        </div>
      )
    },
    { header: "Limit Kredit", cell: ({ row }) => formatRupiah(row.original.creditLimit) },
    {
      header: "Terpakai",
      cell: ({ row }) => <span className="font-semibold text-orange-600">{formatRupiah(row.original.outstandingBalance)}</span>
    },
    { header: "Sisa Limit", cell: ({ row }) => formatRupiah(row.original.availableCredit) },
    {
      header: "Status",
      cell: ({ row }) => <Badge variant={row.original.eligible ? "default" : "secondary"}>{row.original.eligible ? "Layak" : "Tidak Layak"}</Badge>
    },
    {
      header: "Aksi",
      cell: ({ row }) =>
        can("konsumen", "update") && (
          <Button size="sm" onClick={() => setRepayTarget(row.original)}>
            <Store className="mr-2 h-4 w-4" /> Bayar
          </Button>
        )
    }
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Piutang Anggota" description="Piutang kredit anggota di Toko (Kredit Anggota) yang belum lunas" />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard title="Total Piutang Anggota" value={formatRupiah(totalOutstanding)} icon={Receipt} isLoading={isPending} />
        <StatCard title="Jumlah Anggota Menunggak" value={String(memberCount)} icon={Users} isLoading={isPending} />
      </div>

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        pagination={{ page, limit: LIMIT, total: data?.meta.total ?? 0, onPageChange: setPage }}
        search={{ value: search, onChange: setSearch, placeholder: "Cari nama, No. Anggota..." }}
        emptyMessage="Tidak ada piutang anggota yang belum lunas"
      />

      {repayTarget && (
        <CreditRepaymentDialog
          memberId={repayTarget.memberId}
          outstandingBalance={repayTarget.outstandingBalance}
          open={Boolean(repayTarget)}
          onOpenChange={(open) => !open && setRepayTarget(null)}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: ["konsumen", "credit", "outstanding"] })}
        />
      )}
    </div>
  );
}
