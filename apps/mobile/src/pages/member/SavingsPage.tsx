import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { memberApiFetchPage } from "@/api/memberClient";
import { formatRupiahSingkat } from "@/lib/format";
import { CardList } from "@/components/shared/CardList";
import { Badge } from "@/components/shared/Badge";

interface MySavingRow {
  id: string;
  savingConfig: { name: string; type: string };
  balance: string;
  isActive: boolean;
}

const LIMIT = 20;

// Same CardList pattern as staff pages/savings/SavingsPage.tsx, but no search
// box and no member column — every row here already belongs to the caller.
export function MemberSavingsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["member", "savings", page],
    queryFn: () => memberApiFetchPage<MySavingRow[]>(`/member/savings?page=${page}&limit=${LIMIT}`)
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Simpanan Saya</h1>

      <CardList
        items={query.data?.items ?? []}
        keyExtractor={(s) => s.id}
        isLoading={query.isPending}
        isError={query.isError}
        errorMessage="Gagal memuat data simpanan"
        onRetry={() => query.refetch()}
        onItemClick={(s) => navigate(`/anggota/simpanan/${s.id}`)}
        pagination={{ page, limit: LIMIT, total: query.data?.meta?.total ?? 0, onPageChange: setPage }}
        emptyMessage="Anda belum memiliki rekening simpanan"
        renderCard={(s) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{s.savingConfig.name}</p>
              <Badge variant="secondary">{s.savingConfig.type}</Badge>
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
