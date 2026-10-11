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

  const columns: ColumnDef<MemberSavingsSummary>[] = [
    {
      header: "Anggota",
      cell: ({ row }) => (
        <div>
          <button
            type="button"
            className="font-medium hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/members/${row.original.memberId}`);
            }}
          >
            {row.original.fullName}
          </button>
          <p className="font-mono text-xs text-muted-foreground">{row.original.memberNumber}</p>
        </div>
      )
    },
    { header: "No. Rekening", cell: ({ row }) => <span className="font-mono text-xs">{row.original.accountNumber}</span> },
    {
      header: "Rekening Simpanan",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.savings.map((s) => (
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
      cell: ({ row }) => <span className="font-semibold">{formatRupiah(row.original.totalBalance)}</span>
    }
  ];

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
        description="Daftar rekening simpanan anggota"
        actions={
          can("savings", "create") && (
            <Button onClick={() => navigate("/savings/new")}>
              <PiggyBank className="mr-2 h-4 w-4" /> Buka Rekening
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

      <DataTable
        columns={columns}
        data={data?.items ?? []}
        isLoading={isPending}
        isError={isError}
        errorMessage={error instanceof Error ? error.message : undefined}
        onRetry={refetch}
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v);
            setPage(1);
          },
          placeholder: "Cari nama anggota..."
        }}
        pagination={{ page, limit: LIMIT, total: data?.meta.total ?? 0, onPageChange: setPage }}
        getRowKey={(row) => row.memberId}
        renderExpanded={renderAccounts}
        emptyMessage="Belum ada rekening simpanan"
      />
    </div>
  );
}
