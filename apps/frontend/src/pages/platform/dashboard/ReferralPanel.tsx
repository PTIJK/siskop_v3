import { Link } from "react-router-dom";
import type { ReferralSummary } from "@siskop/types";
import { formatRupiah } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasReferralActivity } from "./dashboardView";

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ReferralPanel({ referrals }: { referrals: ReferralSummary }) {
  const rupiah = (amount: string) => formatRupiah(Number(amount));
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Program mitra referral</CardTitle>
        <p className="text-xs text-muted-foreground">Omzet dari koperasi rujukan (sebelum PPN) dan komisi mitra</p>
      </CardHeader>
      <CardContent>
        {!hasReferralActivity(referrals) ? (
          <p className="flex h-[120px] items-center justify-center text-sm text-muted-foreground">Belum ada mitra atau koperasi rujukan.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Stat label="Omzet rujukan bulan ini" value={rupiah(referrals.referredRevenueThisMonth)} hint={`Total ${rupiah(referrals.referredRevenueTotal)}`} />
            <Stat label="Komisi bulan ini" value={rupiah(referrals.commissionThisMonth)} />
            <Stat label="Komisi belum dibayar" value={rupiah(referrals.commissionOutstanding)} />
            <Stat
              label="Mitra aktif"
              value={referrals.activePartners.toLocaleString("id-ID")}
              hint={`${referrals.referredTenants.toLocaleString("id-ID")} koperasi dirujuk`}
            />
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-4 text-xs">
          <Link className="underline underline-offset-2" to="/platform/partners">
            {referrals.pendingApplications > 0 ? `${referrals.pendingApplications} pendaftaran menunggu ditinjau` : "Kelola mitra"}
          </Link>
          <Link className="underline underline-offset-2" to="/platform/payouts">
            Pembayaran komisi
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
