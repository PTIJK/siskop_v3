import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetchPage } from "@/api/client";
import { formatRupiahSingkat } from "@/lib/format";
import { CardList } from "@/components/shared/CardList";
import { Badge } from "@/components/shared/Badge";

interface SavingRow {
  id: string;
  member: { fullName: string; memberId: string; accountNumber: string };
  savingConfig: { name: string; type: string };
  balance: string;
  isActive: boolean;
}

const LIMIT = 20;

const TYPE_OPTIONS = [
  { value: "", label: "Semua Jenis" },
  { value: "POKOK", label: "Simpanan Pokok" },
  { value: "WAJIB", label: "Simpanan Wajib" },
  { value: "SUKARELA", label: "Simpanan Sukarela" }
];

// FR-MOB-SAV-01 (docs/06-PRD-SISKOP-Mobile-Version.md §7): same fields as
// desktop's SavingsPage 5-column DataTable (Anggota/No. Rekening/Jenis
// Simpanan/Saldo/Status), reflowed into a card, plus the type filter —
// which required a backend fix (`GET /api/savings?type=` was silently
// ignored before this session; see apps/backend/src/modules/savings/
// service.ts) since desktop's own dropdown for this filter was non-functional.
export function SavingsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["savings", { search, typeFilter, page }],
    queryFn: () =>
      apiFetchPage<SavingRow[]>(
        `/savings?page=${page}&limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ""}${
          typeFilter ? `&type=${typeFilter}` : ""
        }`
      )
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Simpanan</h1>

      <select
        value={typeFilter}
        onChange={(e) => {
          setTypeFilter(e.target.value);
          setPage(1);
        }}
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
      >
        {TYPE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <CardList
        items={query.data?.items ?? []}
        keyExtractor={(s) => s.id}
        isLoading={query.isPending}
        isError={query.isError}
        errorMessage="Gagal memuat data simpanan"
        onRetry={() => query.refetch()}
        onItemClick={(s) => navigate(`/savings/${s.id}`)}
        search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: "Cari nama anggota..." }}
        pagination={{ page, limit: LIMIT, total: query.data?.meta?.total ?? 0, onPageChange: setPage }}
        emptyMessage="Belum ada rekening simpanan"
        renderCard={(s) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.member.fullName}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{s.member.memberId}</p>
              <div className="mt-1 flex items-center gap-1.5">
                <span className="truncate text-xs text-muted-foreground">{s.savingConfig.name}</span>
                <Badge variant="secondary">{s.savingConfig.type}</Badge>
              </div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <p className="text-sm font-bold">{formatRupiahSingkat(s.balance)}</p>
              <Badge variant={s.isActive ? "default" : "secondary"}>{s.isActive ? "Aktif" : "Nonaktif"}</Badge>
            </div>
          </div>
        )}
      />
    </div>
  );
}
