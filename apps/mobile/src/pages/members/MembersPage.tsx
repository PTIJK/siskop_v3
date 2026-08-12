import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Member } from "@siskop/types";
import { apiFetchPage } from "@/api/client";
import { CardList } from "@/components/shared/CardList";
import { Badge } from "@/components/shared/Badge";

const LIMIT = 20;

// FR-MOB-MEM-01 (docs/06-PRD-SISKOP-Mobile-Version.md §7): same fields as
// desktop's MembersPage 8-column DataTable (ID Anggota/Nama/NIK/No. Rekening/
// Pekerjaan/Status/Tgl. Daftar), reflowed into one card per member instead of
// a row — nothing dropped, per §12 item 5's "same data, different layout"
// constraint.
export function MembersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["members", { search, page }],
    queryFn: () =>
      apiFetchPage<Member[]>(
        `/members?page=${page}&limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ""}`
      )
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Anggota</h1>

      <CardList
        items={query.data?.items ?? []}
        keyExtractor={(m) => m.id}
        isLoading={query.isPending}
        isError={query.isError}
        errorMessage="Gagal memuat data anggota"
        onRetry={() => query.refetch()}
        onItemClick={(m) => navigate(`/members/${m.id}`)}
        search={{ value: search, onChange: (v) => { setSearch(v); setPage(1); }, placeholder: "Cari nama, NIK, atau ID..." }}
        pagination={{ page, limit: LIMIT, total: query.data?.meta?.total ?? 0, onPageChange: setPage }}
        emptyMessage="Belum ada anggota"
        renderCard={(m) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{m.fullName}</p>
              <p className="truncate font-mono text-xs text-muted-foreground">{m.memberId}</p>
              <p className="mt-1 truncate text-xs text-muted-foreground">{m.occupation}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Badge variant={m.isActive ? "default" : "secondary"}>{m.isActive ? "Aktif" : "Nonaktif"}</Badge>
              <p className="font-mono text-xs text-muted-foreground">{m.accountNumber}</p>
            </div>
          </div>
        )}
      />
    </div>
  );
}
