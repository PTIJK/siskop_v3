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
import { PiggyBank } from "lucide-react";

interface SavingRow {
  id: string;
  member: { fullName: string; memberId: string; accountNumber: string };
  savingConfig: { name: string; type: string };
  balance: string;
  isActive: boolean;
}

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
      apiFetchPage<SavingRow[]>(
        `/savings?page=${page}&limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ""}${
          typeFilter ? `&type=${typeFilter}` : ""
        }`
      )
  });

  const columns: ColumnDef<SavingRow>[] = [
    {
      header: "Anggota",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.member.fullName}</p>
          <p className="font-mono text-xs text-muted-foreground">{row.original.member.memberId}</p>
        </div>
      )
    },
    { header: "No. Rekening", cell: ({ row }) => <span className="font-mono text-xs">{row.original.member.accountNumber}</span> },
    {
      header: "Jenis Simpanan",
      cell: ({ row }) => (
        <div>
          <p className="text-sm">{row.original.savingConfig.name}</p>
          <Badge variant="secondary" className="text-xs">
            {row.original.savingConfig.type}
          </Badge>
        </div>
      )
    },
    { header: "Saldo", cell: ({ row }) => <span className="font-semibold">{formatRupiah(row.original.balance)}</span> },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "default" : "secondary"}>
          {row.original.isActive ? "Aktif" : "Nonaktif"}
        </Badge>
      )
    }
  ];

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
        onRowClick={(row) => navigate(`/savings/${row.id}`)}
        emptyMessage="Belum ada rekening simpanan"
      />
    </div>
  );
}
