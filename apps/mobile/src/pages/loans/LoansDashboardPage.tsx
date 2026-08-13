import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronRight } from "lucide-react";
import type { LoanConfig } from "@siskop/types";
import { apiFetch, apiFetchPage } from "@/api/client";
import { formatRupiahSingkat } from "@/lib/format";
import { CardList } from "@/components/shared/CardList";
import { Badge } from "@/components/shared/Badge";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { cn } from "@/lib/utils";

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

const STATUS_TABS = [
  { value: "", label: "Semua" },
  { value: "ACTIVE", label: "Aktif" },
  { value: "COMPLETED", label: "Lunas" }
];

// FR-MOB-LOAN-01 (docs/06-PRD-SISKOP-Mobile-Version.md §7): full parity with
// desktop's LoansDashboardPage — overdue banner, status tabs, type filter,
// and all 9 data points from the 9-column DataTable, reflowed into a card.
// Backend `listLoans()` correctly honors status/loanConfigId (unlike Savings'
// now-fixed type filter), so no backend change was needed for this module.
export function LoansDashboardPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const { data: overdue } = useQuery({
    queryKey: ["loans", "overdue-count"],
    queryFn: () => apiFetch<unknown[]>("/loans/overdue")
  });
  const { data: loanConfigs = [] } = useQuery({
    queryKey: ["loans", "configs"],
    queryFn: () => apiFetch<LoanConfig[]>("/loans/configs")
  });
  const overdueCount = overdue?.length ?? 0;

  const query = useQuery({
    queryKey: ["loans", { search, typeFilter, status, page }],
    queryFn: () =>
      apiFetchPage<LoanRow[]>(
        `/loans?page=${page}&limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ""}${
          status ? `&status=${status}` : ""
        }${typeFilter ? `&loanConfigId=${typeFilter}` : ""}`
      )
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Pinjaman</h1>

      {/* Always rendered (not conditional on overdueCount) — desktop's
          Sidebar has "Anggota Menunggak" as a permanent submenu item
          regardless of whether any loan is currently overdue, and mobile's
          bottom-nav has no equivalent submenu, so this is the only entry
          point (docs/06-PRD-SISKOP-Mobile-Version.md §7, FR-MOB-LOAN-01). A
          conditional-only banner would make the screen unreachable whenever
          overdueCount is 0. */}
      <button
        onClick={() => navigate("/loans/overdue")}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left",
          overdueCount > 0 ? "border-red-300 bg-red-50" : "border-muted bg-muted/40"
        )}
      >
        <AlertTriangle className={cn("h-4 w-4 shrink-0", overdueCount > 0 ? "text-red-600" : "text-muted-foreground")} />
        <p className={cn("flex-1 text-xs font-medium", overdueCount > 0 ? "text-red-800" : "text-muted-foreground")}>
          {overdueCount > 0
            ? `${overdueCount} anggota memiliki pinjaman bermasalah (MACET/DIRAGUKAN)`
            : "Tidak ada pinjaman bermasalah saat ini"}
        </p>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      <select
        value={typeFilter}
        onChange={(e) => {
          setTypeFilter(e.target.value);
          setPage(1);
        }}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      >
        <option value="">Semua Jenis Pembiayaan</option>
        {loanConfigs.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <div className="flex gap-1 rounded-md bg-muted p-1">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            className={cn(
              "flex-1 rounded-sm px-2 py-1.5 text-xs font-medium transition-colors",
              status === tab.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <CardList
        items={query.data?.items ?? []}
        keyExtractor={(l) => l.id}
        isLoading={query.isPending}
        isError={query.isError}
        errorMessage="Gagal memuat data pinjaman"
        onRetry={() => query.refetch()}
        onItemClick={(l) => navigate(`/loans/${l.id}`)}
        search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: "Cari nama, ID anggota..." }}
        pagination={{ page, limit: LIMIT, total: query.data?.meta?.total ?? 0, onPageChange: setPage }}
        emptyMessage="Belum ada data pinjaman"
        renderCard={(l) => (
          <div>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.member.fullName}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{l.member.memberId}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <Badge variant="outline">{l.status}</Badge>
                <KOLBadge category={l.kolCategory} />
              </div>
            </div>
            <p className="mt-1.5 truncate text-xs text-muted-foreground">
              {l.loanConfig.name} · {l.termMonths} bln
            </p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pokok</span>
                <span className="font-medium">{formatRupiahSingkat(l.principalAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sisa</span>
                <span className="font-semibold text-orange-600">{formatRupiahSingkat(l.remainingAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total</span>
                <span className="font-medium">{formatRupiahSingkat(l.totalAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">/bln</span>
                <span className="font-medium">{formatRupiahSingkat(l.monthlyPayment)}</span>
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
