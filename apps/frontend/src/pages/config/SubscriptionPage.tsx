import { useSearchParams } from "react-router-dom";
import type { PricingLimits, TenantSubscriptionInfo } from "@siskop/types";
import { Check, Lock } from "lucide-react";
import { usePublicPricing } from "@/features/onboarding/api";
import { useSubscription } from "@/hooks/useEntitlements";
import { formatRupiah, formatTanggalIndonesia } from "@/lib/format";
import { unlockingPackages, usageMeter } from "@/lib/entitlements";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { PageLoading } from "@/components/shared/LoadingSpinner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

const STATUS: Record<TenantSubscriptionInfo["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ACTIVE: { label: "Aktif", variant: "default" },
  PENDING_PAYMENT: { label: "Menunggu pembayaran", variant: "secondary" },
  PAST_DUE: { label: "Terlambat bayar", variant: "destructive" },
  CANCELLED: { label: "Dihentikan", variant: "outline" }
};

const METERS: { key: keyof PricingLimits; label: string }[] = [
  { key: "members", label: "Anggota aktif" },
  { key: "users", label: "Pengguna aktif" },
  { key: "savingTypes", label: "Jenis simpanan" },
  { key: "loanTypes", label: "Jenis pinjaman" }
];

const INVOICE_TYPE = { REGISTRATION: "Pendaftaran", RENEWAL: "Perpanjangan", ADDON: "Add-on", SUPPORT: "Dukungan" } as const;

export function SubscriptionPage() {
  const { data: info, isPending } = useSubscription();
  const catalog = usePublicPricing();
  const [params] = useSearchParams();
  const highlight = params.get("fitur");

  if (isPending) return <PageLoading />;

  if (!info) {
    return (
      <div className="space-y-6">
        <PageHeader title="Langganan" description="Paket, pemakaian, dan tagihan koperasi Anda." />
        <p className="text-sm text-muted-foreground">Koperasi ini belum memiliki langganan. Hubungi tim SISKOP untuk mengaktifkannya.</p>
      </div>
    );
  }

  const status = STATUS[info.status];
  const features = catalog.data?.features ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="Langganan" description="Paket, pemakaian, dan tagihan koperasi Anda." />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle>{info.packageName}</CardTitle>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <CardDescription>
            Ditagih {info.billingCycle === "MONTHLY" ? "bulanan" : "tahunan"}
            {info.nextBillingDate ? ` · tagihan berikutnya ${formatTanggalIndonesia(info.nextBillingDate)}` : " · tanpa tagihan berulang"}
          </CardDescription>
        </CardHeader>
      </Card>

      {info.openInvoice && (
        <Card className="border-amber-300">
          <CardHeader>
            <CardTitle className="text-base">Faktur yang harus dibayar</CardTitle>
            <CardDescription>
              {info.openInvoice.number} · {INVOICE_TYPE[info.openInvoice.type]} · jatuh tempo {formatTanggalIndonesia(info.openInvoice.dueDate)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold">{formatRupiah(info.openInvoice.total)}</p>
            <div>
              <p className="text-sm font-medium">Cara pembayaran</p>
              <p className="whitespace-pre-line text-sm text-muted-foreground">
                {info.paymentInstructions ?? "Petunjuk pembayaran akan dikirim oleh tim SISKOP."}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">Setelah pembayaran dikonfirmasi oleh tim SISKOP, akses akan pulih otomatis.</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pemakaian</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {METERS.map(({ key, label }) => {
            const meter = usageMeter(info.usage[key], info.limits[key]);
            return (
              <div key={key} className="space-y-1.5">
                <div className="flex items-baseline justify-between text-sm">
                  <span>{label}</span>
                  <span className={cn("tabular-nums", (meter.state === "full" || meter.state === "over") && "font-medium text-destructive")}>
                    {meter.limit === null ? `${meter.used} · tanpa batas` : `${meter.used}/${meter.limit}`}
                  </span>
                </div>
                {meter.limit !== null && <Progress value={meter.ratio * 100} className="h-2" aria-label={label} />}
                {meter.state === "over" && <p className="text-xs text-destructive">Melebihi batas paket: data lama tetap aman, tetapi penambahan baru ditolak.</p>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fitur</CardTitle>
          <CardDescription>Fitur yang belum termasuk paket Anda menunjukkan paket yang membukanya.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {features.map((f) => {
              const included = info.features.includes(f.key);
              const where = included || !catalog.data ? [] : unlockingPackages(catalog.data, f.key);
              return (
                <li
                  key={f.key}
                  className={cn("flex items-center gap-3 py-2 text-sm", f.parentKey && "pl-6", highlight === f.key && "rounded bg-amber-50 px-2")}
                >
                  {included ? <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Termasuk" /> : <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-label="Terkunci" />}
                  <span className={cn("flex-1", !included && "text-muted-foreground")}>{f.name}</span>
                  {!included && (
                    <span className="text-xs text-muted-foreground">
                      {where.length > 0 ? `Tersedia di paket ${where.join(", ")}` : "Tersedia di paket Custom"}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
