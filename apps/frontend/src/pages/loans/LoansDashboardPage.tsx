import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { LoanConfig } from "@siskop/types";
import { apiFetch, apiFetchPage } from "@/api/client";
import { formatRupiah } from "@/lib/format";
import { usePermissions } from "@/hooks/usePermissions";
import { DataTable, type ColumnDef } from "@/components/shared/DataTable";
import { PageHeader } from "@/components/shared/PageHeader";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { appendPage } from "@/components/shared/directory-pagination";
import { draftAmount, useFinancialDraftRows, type FinancialListRow } from "@/pages/rat/FinancialDraftRows";
import { AlertTriangle, Plus } from "lucide-react";

interface LoanRow {
  id: string;
  member: { memberId: string; fullName: string };
  loanConfig: { name: string };
  principalAmount: string;
  totalAmount: string;
  monthlyPayment: string;
  remainingAmount: string;
  termMonths: number;
  status: string;
  kolCategory: string;
}

const LIMIT = 20;

function LoansTable({
  status,
  search,
  onSearchChange,
  loanConfigId
}: {
  status?: string;
  search: string;
  onSearchChange: (value: string) => void;
  loanConfigId?: string;
}) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: ["loans", { page, search, status, loanConfigId }],
    queryFn: () =>
      apiFetchPage<LoanRow[]>(
        `/loans?page=${page}&limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ""}${
          status ? `&status=${status}` : ""
        }${loanConfigId ? `&loanConfigId=${loanConfigId}` : ""}`
      )
  });

  const draft = useFinancialDraftRows("loan", !status && !loanConfigId, search);
  const live = data?.items ?? [];
  const total = data?.meta.total ?? 0;
  const rows: FinancialListRow<LoanRow>[] = [
    ...live.map((row) => ({ live: row })),
    ...appendPage(draft.rows, total, live.length, page, LIMIT).map((row) => ({ draft: row }))
  ];
  const columns: ColumnDef<FinancialListRow<LoanRow>>[] = [
    {
      header: "Anggota",
      cell: ({ row: { original } }) => (
        <div>
          <p className="font-medium">{original.draft?.name ?? original.live?.member.fullName}</p>
          <p className="font-mono text-xs text-muted-foreground">{original.draft?.ownerRef ?? original.live?.member.memberId}</p>
          {original.draft && <p className="font-mono text-xs text-muted-foreground">{original.draft.fields.contractRef || original.draft.reference}</p>}
        </div>
      )
    },
    { header: "Jenis Pembiayaan", cell: ({ row: { original } }) => original.draft ? draft.productName(original.draft) : original.live.loanConfig.name },
    { header: "Pokok", cell: ({ row: { original } }) => original.draft ? draftAmount(original.draft, "principalAmount") : formatRupiah(original.live.principalAmount) },
    { header: "Total", cell: ({ row: { original } }) => original.draft ? draftAmount(original.draft, "totalAmount") : formatRupiah(original.live.totalAmount) },
    { header: "Angsuran/bln", cell: ({ row: { original } }) => original.draft ? draftAmount(original.draft, "installmentAmount") : formatRupiah(original.live.monthlyPayment) },
    {
      header: "Sisa",
      cell: ({ row: { original } }) => original.draft ? (
        <div className="text-sm">
          <p className="font-semibold">{draftAmount(original.draft, "remainingPrincipal")} <span className="text-xs text-muted-foreground">pokok</span></p>
          {draftAmount(original.draft, "remainingAmount") && <p>{draftAmount(original.draft, "remainingAmount")} <span className="text-xs text-muted-foreground">kewajiban</span></p>}
        </div>
      ) : <span className="font-semibold text-warning">{formatRupiah(original.live.remainingAmount)}</span>
    },
    { header: "Tenor", cell: ({ row: { original } }) => original.draft
      ? original.draft.fields.termMonths ? original.draft.fields.termMonths + " bln" :
        original.draft.sourceFields.termMonths && "Sisa " + original.draft.sourceFields.termMonths + " bln"
      : original.live.termMonths + " bln" },
    { header: "Status", cell: ({ row: { original } }) => original.draft ? draft.status : <Badge variant="outline">{original.live.status}</Badge> },
    { header: "KOL", cell: ({ row }) => row.original.live ? <KOLBadge category={row.original.live.kolCategory} /> : row.original.draft.sourceFields.kolCategory }
  ];

  if (draft.enabled) columns.push({ header: "Aksi", cell: ({ row }) => row.original.draft ? draft.action(row.original.draft) : null });
  return <>
    {draft.editor}
    <DataTable
      label="Daftar pinjaman"
      columns={columns}
      data={rows}
      isLoading={isPending || draft.loading}
      isError={isError || Boolean(draft.error)}
      errorMessage={(error ?? draft.error)?.message}
      onRetry={() => { void refetch(); draft.refetch(); }}
      pagination={{ page, limit: LIMIT, total: total + draft.rows.length, onPageChange: setPage }}
      getRowKey={(row) => row.draft ? "rat-" + row.draft.sourceRow : row.live.id}
      onRowClick={(row) => row.draft ? draft.open(row.draft) : navigate(`/loans/${row.live.id}`)}
      emptyMessage="Belum ada data pinjaman"
      search={{ value: search, onChange: (value) => { setPage(1); onSearchChange(value); }, placeholder: "Cari nama, ID anggota..." }}
    />
  </>;
}

export function LoansDashboardPage() {
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const { data: overdue } = useQuery({
    queryKey: ["loans", "overdue"],
    queryFn: () => apiFetch<unknown[]>("/loans/overdue")
  });
  const { data: loanConfigs = [] } = useQuery({
    queryKey: ["loans", "configs"],
    queryFn: () => apiFetch<LoanConfig[]>("/loans/configs")
  });
  const overdueCount = overdue?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pinjaman"
        description="Kelola pinjaman anggota koperasi"
        actions={
          can("loans", "create") && (
            <Button onClick={() => navigate("/loans/new")}>
              <Plus className="mr-2 h-4 w-4" /> Ajukan Pinjaman
            </Button>
          )
        }
      />

      {overdueCount > 0 && (
        <div
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3"
          onClick={() => navigate("/loans/overdue")}
        >
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">{overdueCount} anggota memiliki pinjaman bermasalah (MACET/DIRAGUKAN)</p>
          </div>
          <span className="text-xs text-destructive underline">Lihat detail →</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <Select value={typeFilter || "all"} onValueChange={(v) => setTypeFilter(v === "all" ? "" : v)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Semua Jenis Pembiayaan" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Jenis Pembiayaan</SelectItem>
            {loanConfigs.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">Semua Pinjaman</TabsTrigger>
          <TabsTrigger value="active">Aktif</TabsTrigger>
          <TabsTrigger value="completed">Lunas</TabsTrigger>
        </TabsList>
        <TabsContent value="all" className="mt-4">
          <LoansTable key={typeFilter} search={search} onSearchChange={setSearch} loanConfigId={typeFilter} />
        </TabsContent>
        <TabsContent value="active" className="mt-4">
          <LoansTable key={typeFilter} status="ACTIVE" search={search} onSearchChange={setSearch} loanConfigId={typeFilter} />
        </TabsContent>
        <TabsContent value="completed" className="mt-4">
          <LoansTable key={typeFilter} status="COMPLETED" search={search} onSearchChange={setSearch} loanConfigId={typeFilter} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
