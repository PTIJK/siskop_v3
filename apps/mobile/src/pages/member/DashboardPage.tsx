import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PiggyBank, CreditCard, Wallet } from "lucide-react";
import { memberApiFetch } from "@/api/memberClient";
import { formatRupiahSingkat } from "@/lib/format";
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
        <h1 className="text-xl font-semibold tracking-tight">Halo, {member?.fullName ?? "Anggota"}</h1>
        <p className="text-sm text-muted-foreground">{member?.memberId}</p>
      </div>

      {isError ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border py-10 text-center text-destructive">
          <p className="text-sm">Gagal memuat ringkasan.</p>
          <button onClick={() => refetch()} className="rounded-md border px-3 py-1.5 text-xs font-medium">
            Coba lagi
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            title="Total Simpanan"
            value={data ? formatRupiahSingkat(data.totalSavingsBalance) : "-"}
            icon={PiggyBank}
            isLoading={isPending}
            onClick={() => navigate("/anggota/simpanan")}
          />
          <StatCard
            title="Rekening Simpanan"
            value={data ? String(data.savingsAccountCount) : "-"}
            icon={Wallet}
            isLoading={isPending}
            onClick={() => navigate("/anggota/simpanan")}
          />
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
            icon={CreditCard}
            isLoading={isPending}
            onClick={() => navigate("/anggota/pinjaman")}
          />
        </div>
      )}
    </div>
  );
}
