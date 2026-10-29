import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { memberApiFetchPage } from "@/api/memberClient";
import { formatRupiahSingkat } from "@/lib/format";
import { CardList } from "@/components/shared/CardList";
import { KOLBadge } from "@/components/shared/KOLBadge";
import { LoanStatusBadge } from "@/components/shared/LoanStatusBadge";

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
      <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">Pinjaman Saya</h1>

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
              <p className="truncate text-sm font-bold">{l.loanConfig.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <LoanStatusBadge status={l.status} />
                <KOLBadge category={l.kolCategory} />
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className="money text-base font-extrabold">{formatRupiahSingkat(l.remainingAmount)}</p>
              <p className="text-xs text-muted-foreground">sisa</p>
            </div>
          </div>
        )}
      />
    </div>
  );
}
