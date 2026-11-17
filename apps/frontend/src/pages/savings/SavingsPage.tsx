import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetchPage } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronRight, PiggyBank } from "lucide-react";
import { appendPage } from "@/components/shared/directory-pagination";
import { draftAmount, useFinancialDraftRows, type FinancialListRow } from "@/pages/rat/FinancialDraftRows";
import type { MemberSavingsSummary } from "@siskop/types";

const LIMIT = 20;

export function SavingsPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["savings", { page, search, typeFilter }],
    queryFn: () =>
      apiFetchPage<MemberSavingsSummary[]>(
        `/savings/by-member?page=${page}&limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ""}${
          typeFilter ? `&type=${typeFilter}` : ""
        }`
      )
  });

  const draft = useFinancialDraftRows("saving", !typeFilter, search);
  const live = data?.items ?? [];
  const total = data?.meta.total ?? 0;
  const rows: FinancialListRow<MemberSavingsSummary>[] = [
    ...live.map((row) => ({ live: row })),
    ...appendPage(draft.rows, total, live.length, page, LIMIT).map((row) => ({ draft: row }))
  ];
  const columns: ColumnDef<FinancialListRow<MemberSavingsSummary>>[] = [
    {
      header: "Anggota",
      cell: ({ row: { original } }) => original.draft ? (
        <div><p className="font-medium">{original.draft.name}</p><p className="font-mono text-xs text-muted-foreground">{original.draft.ownerRef}</p></div>
      ) : (
        <div>
          <button
            type="button"
            className="font-medium hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/members/${original.live.memberId}`);
            }}
          >
            {original.live.fullName}
          </button>
          <p className="font-mono text-xs text-muted-foreground">{original.live.memberNumber}</p>
        </div>
      )
    },
    { header: "No. Rekening", cell: ({ row }) => <span className="font-mono text-xs">{row.original.live?.accountNumber}</span> },
    {
      header: "Rekening Simpanan",
      cell: ({ row: { original } }) => original.draft ? draft.productName(original.draft) : (
        <div className="flex flex-wrap gap-1">
          {original.live.savings.map((s) => (
            <Badge key={s.id} variant="secondary" className="text-xs">
              {s.type}
            </Badge>
          ))}
        </div>
      )
    },
    {
      header: "Total Saldo",
      className: "text-right",
      cell: ({ row: { original } }) => <span className="font-semibold">{original.draft
        ? draftAmount(original.draft, "balance") : formatRupiah(original.live.totalBalance)}</span>
    }
  ];

  if (draft.enabled) {
    columns.push({ header: "Status", cell: ({ row }) => row.original.draft ? draft.status : null },
      { header: "Aksi", cell: ({ row }) => row.original.draft ? draft.action(row.original.draft) : null });
  }
  const renderAccounts = (row: MemberSavingsSummary) => (
    <ul className="divide-y">
      {row.savings.map((s) => (
        <li key={s.id}>
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded px-2 py-2 text-left text-sm hover:bg-muted"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/savings/${s.id}`);
            }}
          >
            <span className="flex-1">{s.name}</span>
            <Badge variant="outline" className="text-xs">
              {s.type}
            </Badge>
            <span className="w-36 text-right font-medium">{formatRupiah(s.balance)}</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simpanan"
        description="Rekening simpanan per anggota. Untuk setor atau tarik, buka Setor dan tarik di menu."
        actions={
          can("savings", "create") && (
            <Button onClick={() => navigate("/savings/new?mode=buka")}>
              <PiggyBank aria-hidden="true" /> Buka rekening
            </Button>
          )
        }
      />

      <div className="flex items-center gap-3">
        <Select
          value={typeFilter || "all"}
          onValueChange={(v) => {
            setTypeFilter(v === "all" ? "" : v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Semua Jenis" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Jenis</SelectItem>
            <SelectItem value="POKOK">Simpanan Pokok</SelectItem>
            <SelectItem value="WAJIB">Simpanan Wajib</SelectItem>
            <SelectItem value="SUKARELA">Simpanan Sukarela</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {draft.editor}
      <DataTable
        label="Daftar simpanan"
        columns={columns}
        data={rows}
        isLoading={isPending || draft.loading}
        isError={isError || Boolean(draft.error)}
        errorMessage={(error ?? draft.error)?.message}
        onRetry={() => { void refetch(); draft.refetch(); }}
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v);
            setPage(1);
          },
          placeholder: draft.enabled ? "Cari nama atau ID anggota..." : "Cari nama anggota..."
        }}
        pagination={{ page, limit: LIMIT, total: total + draft.rows.length, onPageChange: setPage }}
        getRowKey={(row) => row.draft ? "rat-" + row.draft.sourceRow : row.live.memberId}
        canExpandRow={(row) => Boolean(row.live)}
        onRowClick={(row) => { if (row.draft) draft.open(row.draft); }}
        renderExpanded={(row) => row.live ? renderAccounts(row.live) : null}
        emptyMessage="Belum ada rekening simpanan"
      />
    </div>
  );
}
