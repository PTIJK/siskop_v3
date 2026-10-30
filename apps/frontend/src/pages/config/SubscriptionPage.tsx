import { useSearchParams } from "react-router-dom";
import type { PricingLimits, TenantSubscriptionInfo } from "@siskop/types";
import { Check, Lock } from "lucide-react";
import { usePublicPricing } from "@/features/onboarding/api";
import { useSubscription } from "@/hooks/useEntitlements";
import { formatRupiah, formatTanggalPendek } from "@/lib/format";
import { unlockingPackages } from "@/lib/entitlements";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { LockedFeature } from "@/components/shared/LockedFeature";
import { QuotaMeter } from "@/components/shared/QuotaMeter";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Package } from "lucide-react";

const STATUS: Record<TenantSubscriptionInfo["status"], { label: string; variant: NonNullable<BadgeProps["variant"]> }> = {
  ACTIVE: { label: "Aktif", variant: "ok" },
  PENDING_PAYMENT: { label: "Menunggu pembayaran", variant: "warn" },
  PAST_DUE: { label: "Terlambat bayar", variant: "bad" },
  CANCELLED: { label: "Dihentikan", variant: "info" }
};

const METERS: { key: keyof PricingLimits; label: string }[] = [
  { key: "members", label: "Anggota aktif" },
  { key: "users", label: "Pengguna aktif" },
  { key: "savingTypes", label: "Jenis simpanan" },
  { key: "loanTypes", label: "Jenis pinjaman" }
];

const INVOICE_TYPE = { REGISTRATION: "Pendaftaran", RENEWAL: "Perpanjangan", ADDON: "Add-on", SUPPORT: "Dukungan" } as const;

function SubscriptionSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true">
      <span className="sr-only">Memuat langganan</span>
      <Skeleton className="h-24 w-full rounded-[16px]" />
      <Skeleton className="h-40 w-full rounded-[16px]" />
      <Skeleton className="h-56 w-full rounded-[16px]" />
    </div>
  );
}

export function SubscriptionPage() {
  const { data: info, isPending, isError, refetch } = useSubscription();
  const catalog = usePublicPricing();
  const [params] = useSearchParams();
  const highlight = params.get("fitur");

  const header = <PageHeader title="Langganan" description="Paket, pemakaian, dan tagihan koperasi Anda." />;

  if (isPending) {
    return (
      <div className="space-y-5">
        {header}
        <SubscriptionSkeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="space-y-5">
        {header}
        <Card>
          <CardContent role="alert">
            <EmptyState
              title="Langganan belum bisa dimuat"
              description="Periksa koneksi Anda, lalu coba lagi."
              action={
                <Button variant="outline" onClick={() => void refetch()}>
                  Coba lagi
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="space-y-5">
        {header}
        <Card>
          <CardContent>
            <EmptyState
              icon={Package}
              title="Koperasi ini belum memiliki langganan"
              description="Hubungi tim SISKOP untuk mengaktifkannya."
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const status = STATUS[info.status];
  const features = catalog.data?.features ?? [];
  const lockedFeature = highlight ? features.find((f) => f.key === highlight) : undefined;
  const lockedHere = highlight !== null && !info.features.includes(highlight);

  return (
    <div className="space-y-5">
      {header}

      {lockedFeature && lockedHere ? (
        <LockedFeature
          featureName={lockedFeature.name}
          packageName={info.packageName}
          description="Fitur ini belum aktif untuk koperasi Anda."
          unlockedBy={catalog.data ? unlockingPackages(catalog.data, lockedFeature.key) : undefined}
        />
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-lg">Paket {info.packageName}</CardTitle>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <CardDescription>
            Ditagih {info.billingCycle === "MONTHLY" ? "bulanan" : "tahunan"}
            {info.nextBillingDate ? ` · tagihan berikutnya ${formatTanggalPendek(info.nextBillingDate)}` : " · tanpa tagihan berulang"}
          </CardDescription>
        </CardHeader>
      </Card>

      {info.openInvoice && (
        <Card className="border-warning/50">
          <CardHeader>
            <CardTitle>Tagihan yang harus dibayar</CardTitle>
            <CardDescription>
              {info.openInvoice.number} · {INVOICE_TYPE[info.openInvoice.type]} · jatuh tempo {formatTanggalPendek(info.openInvoice.dueDate)}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-[28px] font-extrabold tracking-tight tabular-nums">{formatRupiah(info.openInvoice.total)}</p>
            <div>
              <p className="text-sm font-bold">Cara pembayaran</p>
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
          <CardTitle>Pemakaian kuota</CardTitle>
          <CardDescription>Data lama tetap aman. Yang dibatasi hanya penambahan baru setelah kuota penuh.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {METERS.map(({ key, label }) => (
            <QuotaMeter key={key} label={label} used={info.usage[key]} limit={info.limits[key]} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fitur</CardTitle>
          <CardDescription>Fitur yang belum termasuk paket Anda menunjukkan paket yang membukanya.</CardDescription>
        </CardHeader>
        <CardContent>
          {catalog.isPending ? (
            <div className="space-y-2" role="status" aria-busy="true">
              <span className="sr-only">Memuat daftar fitur</span>
              <Skeleton className="h-6 w-full" />
              <Skeleton className="h-6 w-5/6" />
              <Skeleton className="h-6 w-4/6" />
            </div>
          ) : catalog.isError ? (
            <p role="alert" className="text-sm text-muted-foreground">
              Daftar fitur belum bisa dimuat.{" "}
              <button type="button" onClick={() => void catalog.refetch()} className="font-bold underline">
                Coba lagi
              </button>
            </p>
          ) : (
            <ul className="divide-y">
              {features.map((f) => {
                const included = info.features.includes(f.key);
                const where = included || !catalog.data ? [] : unlockingPackages(catalog.data, f.key);
                return (
                  <li
                    key={f.key}
                    className={cn("flex items-center gap-3 py-2.5 text-sm", f.parentKey && "pl-6", highlight === f.key && "-mx-2 rounded-[10px] bg-accent px-2")}
                  >
                    {included ? (
                      <Check className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                    ) : (
                      <Lock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className={cn("flex-1 font-semibold", !included && "font-medium text-muted-foreground")}>
                      {f.name}
                      <span className="sr-only">{included ? " (termasuk)" : " (terkunci)"}</span>
                    </span>
                    {!included && (
                      <span className="text-xs text-muted-foreground">
                        {where.length > 0 ? `Tersedia di paket ${where.join(", ")}` : "Tersedia di paket Custom"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
