import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { memberApiFetchPage } from "@/api/memberClient";
import { formatRupiahSingkat } from "@/lib/format";
import { CardList } from "@/components/shared/CardList";
import { Badge } from "@/components/shared/Badge";
import { KOLBadge } from "@/components/shared/KOLBadge";

interface MyLoanRow {
  id: string;
  loanConfig: { name: string; type: string };
  remainingAmount: string;
  status: string;
  kolCategory: string;
}

const LIMIT = 20;

export function MemberLoansPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const query = useQuery({
    queryKey: ["member", "loans", page],
    queryFn: () => memberApiFetchPage<MyLoanRow[]>(`/member/loans?page=${page}&limit=${LIMIT}`)
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">Pinjaman Saya</h1>

      <CardList
        items={query.data?.items ?? []}
        keyExtractor={(l) => l.id}
        isLoading={query.isPending}
        isError={query.isError}
        errorMessage="Gagal memuat data pinjaman"
        onRetry={() => query.refetch()}
        onItemClick={(l) => navigate(`/anggota/pinjaman/${l.id}`)}
        pagination={{ page, limit: LIMIT, total: query.data?.meta?.total ?? 0, onPageChange: setPage }}
        emptyMessage="Anda belum memiliki pinjaman"
        renderCard={(l) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{l.loanConfig.name}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge variant="outline">{l.status}</Badge>
                <KOLBadge category={l.kolCategory} />
              </div>
            </div>
            <p className="shrink-0 text-sm font-bold text-orange-700">{formatRupiahSingkat(l.remainingAmount)}</p>
          </div>
        )}
      />
    </div>
  );
}
