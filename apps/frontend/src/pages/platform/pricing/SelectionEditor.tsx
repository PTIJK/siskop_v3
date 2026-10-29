import { useMemo } from "react";
import type { BillingCycle, PricingCatalog, PricingSelection, VolumeItem } from "@siskop/types";
import { formatRupiah } from "@/lib/format";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { buildFeatureRows, toggleCustomFeature } from "./pricingAdmin";

const ITEM_LABEL: Record<VolumeItem, string> = {
  MEMBERS: "Anggota tambahan",
  USERS: "Pengguna tambahan",
  SAVING_TYPES: "Jenis simpanan tambahan",
  LOAN_TYPES: "Jenis pinjaman tambahan"
};
const NO_SUPPORT = "none";

/**
 * Picks a package, billing cycle, support plan, Custom features and add-ons.
 * Used by the simulator and by the tenant subscription dialog; it only builds
 * a selection. The server prices it.
 */
export function SelectionEditor({
  catalog,
  value,
  onChange
}: {
  catalog: Pick<PricingCatalog, "packages" | "features" | "volumeAddons" | "supportPlans"> & { settings: Pick<PricingCatalog["settings"], "enabledCycles"> };
  value: PricingSelection;
  onChange: (next: PricingSelection) => void;
}) {
  const pkg = catalog.packages.find((p) => p.code === value.packageCode);
  const pricedRows = useMemo(
    () => buildFeatureRows(catalog.features.filter((f) => f.isActive && Number(f.customPrice) > 0)),
    [catalog.features]
  );
  const qtyOf = (item: VolumeItem) => value.addons?.find((a) => a.itemKey === item)?.qty ?? 0;

  const setQty = (item: VolumeItem, qty: number) => {
    const others = (value.addons ?? []).filter((a) => a.itemKey !== item);
    onChange({ ...value, addons: qty > 0 ? [...others, { itemKey: item, qty }] : others });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Paket</Label>
          <Select
            value={value.packageCode}
            onValueChange={(code) => onChange({ ...value, packageCode: code, featureKeys: [] })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.packages.map((p) => (
                <SelectItem key={p.code} value={p.code}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Siklus tagihan</Label>
          <Select value={value.billingCycle} onValueChange={(v) => onChange({ ...value, billingCycle: v as BillingCycle })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.settings.enabledCycles.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === "MONTHLY" ? "Bulanan" : "Tahunan"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Paket dukungan</Label>
          <Select
            value={value.supportPlanCode ?? NO_SUPPORT}
            onValueChange={(v) => onChange({ ...value, supportPlanCode: v === NO_SUPPORT ? undefined : v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SUPPORT}>Tanpa dukungan</SelectItem>
              {catalog.supportPlans.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  {s.name} ({formatRupiah(s.yearlyCost)}/tahun)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {pkg?.isCustom && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Fitur Custom</p>
          <div className="grid gap-1 sm:grid-cols-2">
            {pricedRows.map(({ feature, depth }) => (
              <label key={feature.key} className="flex items-center gap-2 text-sm" style={{ paddingLeft: `${depth * 16}px` }}>
                <Checkbox
                  checked={(value.featureKeys ?? []).includes(feature.key)}
                  onCheckedChange={(c) =>
                    onChange({ ...value, featureKeys: toggleCustomFeature(value.featureKeys ?? [], feature.key, c === true, catalog.features) })
                  }
                />
                <span>{feature.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">{formatRupiah(feature.customPrice)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Add-on volume</p>
        <div className="grid gap-4 sm:grid-cols-4">
          {catalog.volumeAddons.map((a) => (
            <div key={a.itemKey} className="space-y-1">
              <Label htmlFor={`addon-${a.itemKey}`}>{ITEM_LABEL[a.itemKey]}</Label>
              <Input
                id={`addon-${a.itemKey}`}
                type="number"
                min={0}
                value={qtyOf(a.itemKey)}
                onChange={(e) => setQty(a.itemKey, Math.max(0, Math.floor(Number(e.target.value))))}
              />
              <p className="text-xs text-muted-foreground">
                {formatRupiah(a.price)} per {a.stepQty.toLocaleString("id-ID")} / {a.period === "YEARLY" ? "tahun" : "bulan"}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
