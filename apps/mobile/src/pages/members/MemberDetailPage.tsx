import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Member } from "@siskop/types";
import { apiFetch } from "@/api/client";
import { formatRupiah, formatRupiahSingkat, formatTanggalIndonesia } from "@/lib/format";
import { Badge } from "@/components/shared/Badge";
import { Tabs } from "@/components/shared/Tabs";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { PiggyBank, CreditCard } from "lucide-react";

interface MemberDetail extends Member {
  savings: { id: string; savingConfig: { name: string; type: string }; balance: string; isActive: boolean }[];
  loans: {
    id: string;
    loanConfig: { name: string };
    principalAmount: string;
    totalAmount: string;
    remainingAmount: string;
    status: string;
    kolCategory: string;
  }[];
}

// FR-MOB-MEM-02 (docs/06-PRD-SISKOP-Mobile-Version.md §7): same 3 tabs and
// same data as desktop's MemberDetailPage — Setor/Tarik/Edit/Ajukan Pinjaman
// buttons are dropped since Fase 1 is read-only (§6, §11), not because the
// data behind them is unavailable.
export function MemberDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [ktpLightbox, setKtpLightbox] = useState(false);

  const { data: member, isPending } = useQuery({
    queryKey: ["members", id],
    queryFn: () => apiFetch<MemberDetail>(`/members/${id}`)
  });

  if (isPending) return <PageLoading />;
  if (!member) return <p className="text-center text-sm text-muted-foreground">Anggota tidak ditemukan</p>;

  const activeLoan = member.loans[0];
  const totalSavings = member.savings.reduce((sum, s) => sum + parseFloat(s.balance), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold">{member.fullName}</h1>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge variant="outline" className="font-mono">
            {member.memberId}
          </Badge>
          <Badge variant="outline" className="font-mono">
            {member.accountNumber}
          </Badge>
          <Badge variant={member.isActive ? "default" : "secondary"}>{member.isActive ? "Aktif" : "Nonaktif"}</Badge>
        </div>
      </div>

      <Tabs
        defaultValue="info"
        tabs={[
          {
            value: "info",
            label: "Info Pribadi",
            content: (
              <div className="rounded-lg border bg-card p-4">
                <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    { label: "NIK", value: member.nik },
                    { label: "Pekerjaan", value: member.occupation },
                    { label: "Tempat Lahir", value: member.birthPlace },
                    { label: "Tanggal Lahir", value: member.birthDate ? formatTanggalIndonesia(member.birthDate) : "-" },
                    { label: "Tgl. Daftar", value: formatTanggalIndonesia(member.createdAt) }
                  ].map((item) => (
                    <div key={item.label} className="min-w-0">
                      <dt className="text-xs text-muted-foreground">{item.label}</dt>
                      <dd className="mt-0.5 truncate text-sm font-medium">{item.value}</dd>
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted-foreground">Alamat</dt>
                    <dd className="mt-0.5 text-sm font-medium">{member.address}</dd>
                  </div>
                </dl>

                {member.ktpPhotoUrl && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs text-muted-foreground">Foto KTP</p>
                    <img
                      src={member.ktpPhotoUrl}
                      alt="KTP"
                      className="h-24 w-40 cursor-pointer rounded-md border object-cover"
                      onClick={() => setKtpLightbox(true)}
                    />
                  </div>
                )}
              </div>
            )
          },
          {
            value: "savings",
            label: "Simpanan",
            content: (
              <div className="space-y-3">
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Total Saldo Simpanan</p>
                  <p className="text-xl font-bold">{formatRupiah(totalSavings)}</p>
                </div>
                {member.savings.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-lg border py-8 text-center text-muted-foreground">
                    <PiggyBank className="h-6 w-6" />
                    <p className="text-sm">Belum ada rekening simpanan</p>
                  </div>
                ) : (
                  member.savings.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.savingConfig.name}</p>
                        <Badge variant="secondary" className="mt-1">
                          {s.savingConfig.type}
                        </Badge>
                      </div>
                      <p className="shrink-0 text-sm font-bold">{formatRupiahSingkat(s.balance)}</p>
                    </div>
                  ))
                )}
              </div>
            )
          },
          {
            value: "loans",
            label: "Pinjaman",
            content: activeLoan ? (
              <div className="rounded-lg border bg-card p-4">
                <p className="text-sm font-medium">{activeLoan.loanConfig.name}</p>
                <div className="mt-1 flex gap-1.5">
                  <Badge>{activeLoan.status}</Badge>
                  <Badge variant="outline">{activeLoan.kolCategory}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-1 gap-3">
                  {[
                    { label: "Pokok", value: formatRupiah(activeLoan.principalAmount) },
                    { label: "Total", value: formatRupiah(activeLoan.totalAmount) },
                    { label: "Sisa", value: formatRupiah(activeLoan.remainingAmount), highlight: true }
                  ].map((item) => (
                    <div key={item.label} className="flex items-center justify-between">
                      <dt className="text-xs text-muted-foreground">{item.label}</dt>
                      <dd className={item.highlight ? "text-sm font-bold text-orange-600" : "text-sm font-semibold"}>
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-lg border py-8 text-center text-muted-foreground">
                <CreditCard className="h-6 w-6" />
                <p className="text-sm">Tidak ada pinjaman aktif</p>
              </div>
            )
          }
        ]}
      />

      {ktpLightbox && member.ktpPhotoUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setKtpLightbox(false)}
        >
          <img src={member.ktpPhotoUrl} alt="KTP" className="max-h-[90vh] max-w-[90vw] rounded-lg" />
        </div>
      )}
    </div>
  );
}
