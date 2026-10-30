import { useState } from "react";
import type { PricingCatalogSettings, PricingLimits } from "@siskop/types";
import { apiPut } from "@/api/client";
import { useToast } from "@/hooks/use-toast";
import { FormError } from "@/components/shared/FormError";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage, LIMIT_FIELDS, LimitInput, usePricingDraft, useRefreshPricing } from "./pricingUi";

/** Stored as a fraction (0.11); the owner thinks in percent (11). */
const toPercent = (fraction: string | null) => (fraction === null ? "" : String(Math.round(Number(fraction) * 10000) / 100));

function RulesForm({ initial, packages }: { initial: PricingCatalogSettings; packages: { code: string; name: string }[] }) {
  const { toast } = useToast();
  const refresh = useRefreshPricing();
  const [yearlyMultiplier, setYearlyMultiplier] = useState(initial.yearlyMultiplier);
  const [cycles, setCycles] = useState(initial.enabledCycles);
  const [defaultPackageCode, setDefaultPackageCode] = useState(initial.defaultPackageCode);
  const [customEnabled, setCustomEnabled] = useState(initial.customEnabled);
  const [baseLimits, setBaseLimits] = useState<PricingLimits>(initial.customBaseLimits);
  const [addonsOnFixed, setAddonsOnFixed] = useState(initial.addonsOnFixedPackages);
  const [graceDays, setGraceDays] = useState(initial.paymentGraceDays);
  const [purgeDays, setPurgeDays] = useState(initial.unpaidRegistrationPurgeDays);
  const [taxPercent, setTaxPercent] = useState(toPercent(initial.taxRate));
  const [instructions, setInstructions] = useState(initial.paymentInstructions ?? "");
  const [oneFree, setOneFree] = useState(initial.oneFreeTenantPerRegistrationNo);
  const [error, setError] = useState("");

  const toggleCycle = (c: "MONTHLY" | "YEARLY", on: boolean) => setCycles(on ? [...new Set([...cycles, c])] : cycles.filter((x) => x !== c));

  const save = async () => {
    const percent = taxPercent.trim() === "" ? null : Number(taxPercent.replace(",", "."));
    if (percent !== null && (!Number.isFinite(percent) || percent < 0 || percent > 100)) {
      setError("PPN harus antara 0 dan 100 persen.");
      return;
    }
    if (cycles.length === 0) {
      setError("Aktifkan minimal satu siklus tagihan.");
      return;
    }
    setError("");
    try {
      await apiPut("/platform/pricing/settings", {
        yearlyMultiplier,
        enabledCycles: cycles,
        defaultPackageCode,
        customEnabled,
        customBaseLimits: baseLimits,
        addonsOnFixedPackages: addonsOnFixed,
        paymentGraceDays: graceDays,
        unpaidRegistrationPurgeDays: purgeDays,
        taxRate: percent === null ? null : (percent / 100).toFixed(4),
        paymentInstructions: instructions.trim() === "" ? null : instructions.trim(),
        oneFreeTenantPerRegistrationNo: oneFree
      });
      toast({ title: "Aturan disimpan ke draf" });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <section className="space-y-3">
        <h3 className="font-semibold">Penagihan</h3>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={cycles.includes("MONTHLY")} onCheckedChange={(c) => toggleCycle("MONTHLY", c === true)} />
            Bulanan
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={cycles.includes("YEARLY")} onCheckedChange={(c) => toggleCycle("YEARLY", c === true)} />
            Tahunan
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="r-mult">Pengali harga tahunan (Custom)</Label>
            <Input id="r-mult" type="number" min={1} value={yearlyMultiplier} onChange={(e) => setYearlyMultiplier(Math.max(1, Math.floor(Number(e.target.value))))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-grace">Masa tenggang bayar (hari)</Label>
            <Input id="r-grace" type="number" min={0} value={graceDays} onChange={(e) => setGraceDays(Math.max(0, Math.floor(Number(e.target.value))))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="r-purge">Hapus pendaftaran belum bayar (hari)</Label>
            <Input id="r-purge" type="number" min={0} value={purgeDays} onChange={(e) => setPurgeDays(Math.max(0, Math.floor(Number(e.target.value))))} />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">PPN dan pembayaran</h3>
        <div className="space-y-1">
          <Label htmlFor="r-tax">Tarif PPN (%)</Label>
          <Input id="r-tax" inputMode="decimal" className="w-32" placeholder="mis. 11" value={taxPercent} onChange={(e) => setTaxPercent(e.target.value)} />
          {taxPercent.trim() === "" && <p className="text-xs text-warning">Belum diisi: faktur dibuat tanpa PPN sampai tarif ini diisi.</p>}
        </div>
        <div className="space-y-1">
          <Label htmlFor="r-pay">Petunjuk transfer bank (tampil di faktur)</Label>
          <Textarea id="r-pay" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          {instructions.trim() === "" && <p className="text-xs text-warning">Belum diisi: pendaftar berbayar belum tahu ke mana harus membayar.</p>}
        </div>
        <p className="text-xs text-muted-foreground">
          Format nomor faktur {initial.invoiceNumberFormat} dan penyedia pembayaran "{initial.paymentProvider}" belum bisa diubah di sini.
        </p>
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Paket</h3>
        <div className="space-y-1">
          <Label>Paket bawaan</Label>
          <Select value={defaultPackageCode} onValueChange={setDefaultPackageCode}>
            <SelectTrigger className="w-60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {packages.map((p) => (
                <SelectItem key={p.code} value={p.code}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={customEnabled} onCheckedChange={(c) => setCustomEnabled(c === true)} />
          Paket Custom tersedia
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={addonsOnFixed} onCheckedChange={(c) => setAddonsOnFixed(c === true)} />
          Add-on volume boleh dibeli di paket tetap
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={oneFree} onCheckedChange={(c) => setOneFree(c === true)} />
          Satu paket Free per nomor badan hukum
        </label>
        <div>
          <p className="mb-2 text-sm font-medium">Batas dasar paket Custom</p>
          <div className="grid gap-4 sm:grid-cols-4">
            {LIMIT_FIELDS.map((f) => (
              <LimitInput key={f.key} label={f.label} value={baseLimits[f.key]} onChange={(v) => setBaseLimits({ ...baseLimits, [f.key]: v })} />
            ))}
          </div>
        </div>
      </section>

      <FormError error={error} />
      <Button onClick={() => void save()}>Simpan ke draf</Button>
    </div>
  );
}

export function RulesTab() {
  const { data, isPending, isError } = usePricingDraft();
  if (isPending) return <p className="text-sm text-muted-foreground">Memuat...</p>;
  if (isError) return <p className="text-sm text-destructive">Gagal memuat draf harga.</p>;
  return <RulesForm initial={data.catalog.settings} packages={data.catalog.packages} />;
}
