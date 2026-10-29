import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Wallet } from "lucide-react";
import { memberApiFetch } from "@/api/memberClient";
import { formatRupiah, formatRupiahSingkat } from "@/lib/format";
import { StatCard } from "@/components/shared/StatCard";
import { useMemberAuth } from "@/stores/memberAuth";

interface MemberDashboard {
  totalSavingsBalance: string;
  savingsAccountCount: number;
  activeLoanCount: number;
  totalLoanRemaining: string;
}

export function MemberDashboardPage() {
  const navigate = useNavigate();
  const member = useMemberAuth((s) => s.member);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ["member", "dashboard"],
    queryFn: () => memberApiFetch<MemberDashboard>("/member/dashboard")
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[26px] font-extrabold leading-tight tracking-[-0.02em]">
          Halo, {member?.fullName ?? "Anggota"}
        </h1>
        <p className="money mt-0.5 text-sm text-muted-foreground">{member?.memberId}</p>
      </div>

      {isError ? (
        <div
          role="alert"
          className="flex flex-col items-center gap-2 rounded-[16px] border bg-card py-10 text-center text-destructive"
        >
          <p className="text-sm font-semibold">Gagal memuat ringkasan.</p>
          <button
            onClick={() => refetch()}
            className="min-h-11 rounded-md border border-input bg-card px-4 text-[13px] font-bold text-foreground hover:bg-muted"
          >
            Coba lagi
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => navigate("/anggota/simpanan")}
            className="block w-full rounded-[20px] border border-hero-line bg-hero p-5 text-left text-hero-foreground transition-colors active:bg-muted"
          >
            <span className="text-[13px] font-semibold text-hero-muted">Total simpanan</span>
            {isPending ? (
              <span className="mt-2 block h-9 w-44 animate-pulse rounded bg-muted" />
            ) : (
              <span className="money mt-1 block truncate text-[32px] font-extrabold leading-tight tracking-[-0.02em]">
                {data ? formatRupiah(data.totalSavingsBalance) : "-"}
              </span>
            )}
            <span className="mt-1 block text-xs text-hero-muted">
              {data ? `${data.savingsAccountCount} rekening simpanan` : " "}
            </span>
          </button>

          <div className="grid grid-cols-2 gap-3">
            <StatCard
              title="Pinjaman Aktif"
              value={data ? String(data.activeLoanCount) : "-"}
              icon={CreditCard}
              isLoading={isPending}
              onClick={() => navigate("/anggota/pinjaman")}
            />
            <StatCard
              title="Sisa Pinjaman"
              value={data ? formatRupiahSingkat(data.totalLoanRemaining) : "-"}
              icon={Wallet}
              isLoading={isPending}
              onClick={() => navigate("/anggota/pinjaman")}
            />
          </div>
        </>
      )}
    </div>
  );
}
