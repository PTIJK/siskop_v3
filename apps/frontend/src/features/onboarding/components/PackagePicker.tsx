import { useMemo } from "react";
import type { BillingCycle, PricingQuote, PricingSelection, PublicPricingCatalog, VolumeItem } from "@siskop/types";
import { Check, Minus } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buildFeatureRows, toggleCustomFeature } from "@/lib/featureTree";
import { rupiah } from "../api";
import { formatTaxRate, priceOf, requiredCustomFeatures, unitAllowed, UNIT_CHOICES, yearlySaving, type UnitChoiceType } from "../registration";
import { PackageFeatures } from "./PackageFeatures";

type Package = PublicPricingCatalog["packages"][number];

const ADDON_LABEL: Record<VolumeItem, string> = {
  MEMBERS: "Anggota tambahan",
  USERS: "Pengguna tambahan",
  SAVING_TYPES: "Jenis simpanan tambahan",
  LOAN_TYPES: "Jenis pinjaman tambahan"
};

export function CycleToggle({ cycles, value, onChange, saving }: { cycles: BillingCycle[]; value: BillingCycle; onChange: (c: BillingCycle) => void; saving: number | null }) {
  if (cycles.length < 2) return null;
  return (
    <div className='cycle-toggle' role='group' aria-label='Siklus tagihan'>
      {cycles.map((c) => (
        <button key={c} type='button' aria-pressed={value === c} onClick={() => onChange(c)}>
          {c === "MONTHLY" ? "Bulanan" : "Tahunan"}
          {c === "YEARLY" && saving !== null && saving > 0 ? <small>hemat hingga {saving}%</small> : null}
        </button>
      ))}
    </div>
  );
}

function priceLabel(pkg: Package, cycle: BillingCycle): string {
  if (pkg.isCustom) return "Sesuai pilihan";
  const price = priceOf(pkg, cycle);
  return price === null ? "Gratis" : rupiah(price);
}

/** The quote the server computed for this selection. The browser never adds prices up itself. */
export function QuoteSummary({ quote, taxRate, loading }: { quote: PricingQuote | undefined; taxRate: string | null; loading?: boolean }) {
  if (!quote) return <p className='form-note'>{loading ? "Menghitung harga…" : "Pilih paket untuk melihat harga."}</p>;
  const tax = formatTaxRate(quote.taxRate ?? taxRate);
  const free = Number(quote.total) === 0;
  return (
    <dl className='quote-summary' aria-live='polite'>
      {quote.lines.map((line) => (
        <div key={`${line.kind}-${line.key}`}>
          <dt>{line.label}</dt>
          <dd>{Number(line.amount) === 0 && line.kind === "PACKAGE" ? "Gratis" : rupiah(line.amount)}</dd>
        </div>
      ))}
      {!free && Number(quote.supportYearly) > 0 ? <p className='form-note'>Biaya dukungan ditagih sekali per tahun.</p> : null}
      {!free && quote.taxRate !== null ? (
        <>
          <div>
            <dt>Subtotal</dt>
            <dd>{rupiah(quote.subtotal)}</dd>
          </div>
          <div>
            <dt>PPN {tax}</dt>
            <dd>{rupiah(quote.taxAmount)}</dd>
          </div>
        </>
      ) : null}
      <div className='quote-total'>
        <dt>{free ? "Total" : "Total tagihan pertama"}</dt>
        <dd>{free ? "Gratis" : rupiah(quote.total)}</dd>
      </div>
      {!free && quote.taxRate === null ? <p className='form-note'>Harga belum termasuk PPN.</p> : null}
    </dl>
  );
}

export function PackagePicker({
  catalog,
  selection,
  onChange,
  unitType
}: {
  catalog: PublicPricingCatalog;
  selection: PricingSelection;
  onChange: (next: PricingSelection) => void;
  unitType: UnitChoiceType;
}) {
  const cycle = selection.billingCycle;
  const chosen = catalog.packages.find((p) => p.code === selection.packageCode);
  const locked = useMemo(() => requiredCustomFeatures(unitType), [unitType]);
  const maxSaving = useMemo(() => Math.max(0, ...catalog.packages.map((p) => yearlySaving(p) ?? 0)), [catalog.packages]);
  const priced = useMemo(() => buildFeatureRows(catalog.features.filter((f) => Number(f.customPrice) > 0)), [catalog.features]);
  const allRows = useMemo(() => buildFeatureRows(catalog.features), [catalog.features]);
  const fixed = catalog.packages.filter((p) => !p.isCustom);
  const qtyOf = (item: VolumeItem) => selection.addons?.find((a) => a.itemKey === item)?.qty ?? 0;
  const unitLabel = UNIT_CHOICES.find((u) => u.type === unitType)?.label ?? "";

  const pick = (pkg: Package) =>
    onChange({
      ...selection,
      packageCode: pkg.code,
      featureKeys: pkg.isCustom ? [...locked] : [],
      addons: catalog.settings.addonsOnFixedPackages || pkg.isCustom ? (selection.addons ?? []) : []
    });
  const setQty = (item: VolumeItem, qty: number) => {
    const others = (selection.addons ?? []).filter((a) => a.itemKey !== item);
    onChange({ ...selection, addons: qty > 0 ? [...others, { itemKey: item, qty }] : others });
  };

  return (
    <div className='package-picker'>
      <CycleToggle cycles={catalog.settings.enabledCycles} value={cycle} onChange={(c) => onChange({ ...selection, billingCycle: c })} saving={maxSaving} />

      <div className='package-choices' role='group' aria-label='Pilih paket'>
        {catalog.packages.map((pkg) => {
          const blocked = !pkg.isCustom && !unitAllowed(unitType, pkg.features);
          const price = priceOf(pkg, cycle);
          return (
            <button
              key={pkg.code}
              type='button'
              className='package-choice'
              aria-pressed={selection.packageCode === pkg.code}
              disabled={blocked || (pkg.isCustom && !catalog.settings.customEnabled)}
              onClick={() => pick(pkg)}
            >
              <h3>{pkg.name}</h3>
              <p className='package-choice-price'>
                {priceLabel(pkg, cycle)}
                {!pkg.isCustom && price !== null ? <span> / {cycle === "MONTHLY" ? "bulan" : "tahun"}</span> : null}
              </p>
              <PackageFeatures pkg={pkg} catalog={catalog} max={2} />
              {blocked ? <small className='package-choice-note'>Tidak mencakup unit {unitLabel}</small> : null}
            </button>
          );
        })}
      </div>

      {chosen?.isCustom ? (
        <fieldset className='custom-builder'>
          <legend>Fitur paket Custom</legend>
          <p className='form-note'>Fitur dasar sudah termasuk. Centang fitur tambahan; yang dibutuhkan fitur lain ikut terpilih.</p>
          <div className='custom-features'>
            {priced.map(({ feature, depth }) => {
              const isLocked = locked.includes(feature.key);
              return (
                <label key={feature.key} style={{ paddingLeft: `${depth * 18}px` }}>
                  <Checkbox
                    checked={(selection.featureKeys ?? []).includes(feature.key)}
                    disabled={isLocked}
                    onCheckedChange={(c) => onChange({ ...selection, featureKeys: toggleCustomFeature(selection.featureKeys ?? [], feature.key, c === true, catalog.features) })}
                  />
                  <span>{feature.name}</span>
                  <span className='custom-feature-price'>{rupiah(feature.customPrice)}/bln</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {catalog.settings.addonsOnFixedPackages || chosen?.isCustom ? (
        <fieldset className='addon-grid'>
          <legend>Kapasitas tambahan (opsional)</legend>
          {catalog.volumeAddons.map((a) => (
            <div className='field' key={a.itemKey}>
              <Label htmlFor={`addon-${a.itemKey}`}>{ADDON_LABEL[a.itemKey]}</Label>
              <Input id={`addon-${a.itemKey}`} type='number' min={0} value={qtyOf(a.itemKey)} onChange={(e) => setQty(a.itemKey, Math.max(0, Math.floor(Number(e.target.value))))} />
              <small>
                {rupiah(a.price)} per {a.stepQty.toLocaleString("id-ID")} / {a.period === "YEARLY" ? "tahun" : "bulan"}
              </small>
            </div>
          ))}
        </fieldset>
      ) : null}

      <fieldset className='support-plans'>
        <legend>Paket dukungan</legend>
        <label>
          <input type='radio' name='support' checked={!selection.supportPlanCode} onChange={() => onChange({ ...selection, supportPlanCode: undefined })} />
          <span>Tanpa dukungan tambahan</span>
        </label>
        {catalog.supportPlans
          .filter((s) => Number(s.yearlyCost) > 0)
          .map((s) => (
            <label key={s.code}>
              <input type='radio' name='support' checked={selection.supportPlanCode === s.code} onChange={() => onChange({ ...selection, supportPlanCode: s.code })} />
              <span>
                {s.name} · {rupiah(s.yearlyCost)}/tahun
                <small>
                  {s.remote ? "Remote" : ""}
                  {s.onsite ? ` · ${s.visitsPerYear} kunjungan` : ""}
                  {s.slaHours !== null ? ` · respons ${s.slaHours} jam` : ""}
                  {s.aiSupport ? " · dukungan AI" : ""}
                </small>
              </span>
            </label>
          ))}
      </fieldset>

      <details className='compare'>
        <summary>Bandingkan semua fitur</summary>
        <div className='compare-scroll'>
          <table>
            <thead>
              <tr>
                <th scope='col'>Fitur</th>
                {fixed.map((p) => (
                  <th key={p.code} scope='col'>
                    {p.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allRows.map(({ feature, depth }) => (
                <tr key={feature.key}>
                  <th scope='row' style={{ paddingLeft: `${depth * 16 + 8}px` }}>
                    {feature.name}
                  </th>
                  {fixed.map((p) => (
                    <td key={p.code}>
                      {p.features.includes(feature.key) ? <Check aria-label='Termasuk' size={16} /> : <Minus aria-label='Tidak termasuk' size={16} />}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
