import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminTenantSubscriptionDetail, PricingCatalog, PricingDraft, PricingLimits, PricingSelection, VolumeItem } from "@siskop/types";
import { apiFetch, apiPut } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { formatRupiahRinci, formatTanggalIndonesia } from "@/lib/format";
import { FormError } from "@/components/shared/FormError";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { limitLabel } from "./pricingAdmin";
import { errorMessage, LIMIT_FIELDS } from "./pricingUi";
import { SelectionEditor } from "./SelectionEditor";

type Status = "ACTIVE" | "PAST_DUE" | "CANCELLED";

function UsageMeters({ detail }: { detail: AdminTenantSubscriptionDetail }) {
  if (!detail.limits) return null;
  const limits = detail.limits;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {LIMIT_FIELDS.map((f) => {
        const used = detail.usage[f.key];
        const cap = limits[f.key];
        const pct = cap === null || cap === 0 ? 0 : Math.min(100, Math.round((used / cap) * 100));
        return (
          <div key={f.key} className="space-y-1">
            <div className="flex justify-between text-sm">
              <span>{f.label}</span>
              <span className={cap !== null && used > cap ? "font-medium text-destructive" : "text-muted-foreground"}>
                {used.toLocaleString("id-ID")} / {limitLabel(cap)}
              </span>
            </div>
            <Progress value={pct} className="h-2" />
          </div>
        );
      })}
    </div>
  );
}

function EditForm({
  tenantId,
  detail,
  catalog,
  onSaved
}: {
  tenantId: string;
  detail: AdminTenantSubscriptionDetail;
  catalog: PricingCatalog;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const sub = detail.subscription;
  const [selection, setSelection] = useState<PricingSelection>({
    packageCode: sub?.packageCode ?? catalog.settings.defaultPackageCode,
    billingCycle: sub?.billingCycle ?? "MONTHLY",
    supportPlanCode: sub?.supportPlanCode ?? undefined,
    featureKeys: sub?.selectedFeatureKeys ?? [],
    addons: Object.entries(sub?.addons ?? {}).map(([itemKey, qty]) => ({ itemKey: itemKey as VolumeItem, qty: qty ?? 0 }))
  });
  const [overrides, setOverrides] = useState<Partial<Record<keyof PricingLimits, string>>>(() =>
    Object.fromEntries(Object.entries(sub?.limitOverrides ?? {}).map(([k, v]) => [k, v === null ? "" : String(v)]))
  );
  const [nextBilling, setNextBilling] = useState(sub?.nextBillingDate?.slice(0, 10) ?? "");
  const [status, setStatus] = useState<Status>(sub && sub.status !== "PENDING_PAYMENT" ? sub.status : "ACTIVE");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setError("");
    const limitOverrides: Partial<PricingLimits> = {};
    for (const f of LIMIT_FIELDS) {
      const raw = overrides[f.key];
      if (raw !== undefined && raw.trim() !== "") limitOverrides[f.key] = Math.max(0, Math.floor(Number(raw)));
    }
    setSaving(true);
    try {
      await apiPut(`/platform/tenants/${tenantId}/subscription`, {
        ...selection,
        featureKeys: selection.featureKeys ?? [],
        limitOverrides,
        nextBillingDate: nextBilling === "" ? null : new Date(`${nextBilling}T00:00:00.000Z`).toISOString(),
        status
      });
      toast({ title: "Langganan diperbarui" });
      await qc.invalidateQueries({ queryKey: ["platform"] });
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <SelectionEditor catalog={catalog} value={selection} onChange={setSelection} />

      <div className="space-y-2">
        <p className="text-sm font-medium">Pengecualian batas (kosongkan jika tidak ada)</p>
        <div className="grid gap-4 sm:grid-cols-4">
          {LIMIT_FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <Label htmlFor={`ov-${f.key}`}>{f.label}</Label>
              <Input
                id={`ov-${f.key}`}
                type="number"
                min={0}
                value={overrides[f.key] ?? ""}
                onChange={(e) => setOverrides({ ...overrides, [f.key]: e.target.value })}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sub-next">Tagihan berikutnya</Label>
          <Input id="sub-next" type="date" value={nextBilling} onChange={(e) => setNextBilling(e.target.value)} />
          <p className="text-xs text-muted-foreground">Kosong = otomatis satu siklus dari sekarang (paket berbayar), atau tanpa tagihan (paket gratis).</p>
        </div>
        <div className="space-y-1">
          <Label>Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as Status)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ACTIVE">Aktif</SelectItem>
              <SelectItem value="PAST_DUE">Lewat jatuh tempo</SelectItem>
              <SelectItem value="CANCELLED">Dibatalkan</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <FormError error={error} />
      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? "Menyimpan..." : "Simpan langganan"}
        </Button>
      </div>
    </div>
  );
}

/** Platform admin's view of one tenant's subscription: current plan, usage against limits, and a change form. */
export function TenantSubscriptionDialog({ tenantId, tenantName, onClose }: { tenantId: string; tenantName: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["platform", "pricing", "tenant-subscription", tenantId],
    queryFn: () => apiFetch<AdminTenantSubscriptionDetail>(`/platform/tenants/${tenantId}/subscription`)
  });
  // Options come from the published version: that is what the engine will price against.
  const published = useQuery({
    queryKey: ["platform", "pricing", "published-catalog"],
    queryFn: async () => {
      const draft = await apiFetch<PricingDraft>("/platform/pricing/draft");
      if (draft.publishedVersion === null) return null;
      return (await apiFetch<{ catalog: PricingCatalog }>(`/platform/pricing/versions/${draft.publishedVersion}`)).catalog;
    }
  });

  const sub = detail.data?.subscription;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Langganan {tenantName}</DialogTitle>
        </DialogHeader>
        {detail.isPending || published.isPending ? (
          <p className="text-sm text-muted-foreground">Memuat...</p>
        ) : detail.isError || published.isError ? (
          <p className="text-sm text-destructive">Gagal memuat langganan.</p>
        ) : published.data === null ? (
          <p className="text-sm text-muted-foreground">Belum ada versi harga yang dipublikasikan. Publikasikan dulu di Harga & Paket.</p>
        ) : (
          <div className="space-y-5">
            {sub ? (
              <div className="space-y-3 rounded-md border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{sub.packageName}</span>
                  <Badge variant={sub.status === "ACTIVE" ? "default" : "secondary"}>{sub.status}</Badge>
                  <Badge variant="outline">{sub.billingCycle === "MONTHLY" ? "Bulanan" : "Tahunan"}</Badge>
                  <span className="ml-auto text-sm">{formatRupiahRinci(sub.amountPerCycle)} / siklus</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Harga versi v{sub.pricingVersion} · dibuat via {sub.createdVia} · tagihan berikutnya{" "}
                  {sub.nextBillingDate ? formatTanggalIndonesia(sub.nextBillingDate) : "-"}
                </p>
                <UsageMeters detail={detail.data} />
              </div>
            ) : (
              <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Koperasi ini belum punya langganan.</p>
            )}
            <EditForm tenantId={tenantId} detail={detail.data} catalog={published.data} onSaved={onClose} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
