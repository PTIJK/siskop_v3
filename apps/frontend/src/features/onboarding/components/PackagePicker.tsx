import { useMemo } from "react";
import type { BillingCycle, PricingQuote, PricingSelection, PublicPricingCatalog } from "@siskop/types";
import { Checkbox } from "@/components/ui/checkbox";
import { buildFeatureRows, toggleCustomFeature } from "@/lib/featureTree";
import { rupiah } from "../api";
import { formatTaxRate, priceOf, requiredCustomFeatures, unitAllowed, UNIT_CHOICES, yearlySaving, type UnitChoiceType } from "../registration";
import { PackageFeatures } from "./PackageFeatures";

type Package = PublicPricingCatalog["packages"][number];

export function CycleToggle({ cycles, value, onChange, saving }: { cycles: BillingCycle[]; value: BillingCycle; onChange: (c: BillingCycle) => void; saving: number | null }) {
  if (cycles.length < 2) return null;
  return (
    <div className='billing-choice'>
      <div className='cycle-toggle' role='group' aria-label='Periode tagihan'>
        {cycles.map((c) => (
          <button key={c} type='button' aria-pressed={value === c} onClick={() => onChange(c)}>
            {c === "MONTHLY" ? "Bulanan" : "Tahunan"}
          </button>
        ))}
      </div>
      <p className='form-note' aria-live='polite'>
        {value === "MONTHLY" ? "Paket berbayar ditagih setiap bulan." : "Paket berbayar ditagih sekaligus untuk 12 bulan."}
        {value === "YEARLY" && saving !== null && saving > 0 ? ` Hemat hingga ${saving}% dibandingkan tagihan bulanan.` : null}
      </p>
    </div>
  );
}

function priceLabel(pkg: Package, cycle: BillingCycle): string {
  if (pkg.isCustom) return "Sesuai pilihan";
  const price = priceOf(pkg, cycle);
  return price === null ? "Gratis" : rupiah(price);
}

/** The quote the server computed for this selection. The browser never adds prices up itself. */
export function QuoteSummary({ quote, taxRate, loading, compact = false }: {
  quote: PricingQuote | undefined; taxRate: string | null; loading?: boolean; compact?: boolean;
}) {
  if (!quote) return <p className='form-note'>{loading ? "Menghitung harga…" : "Pilih paket untuk melihat harga."}</p>;
  const tax = formatTaxRate(quote.taxRate ?? taxRate);
  const free = Number(quote.total) === 0;
  const packageOnly = compact && quote.lines.length === 1 && quote.lines[0]?.kind === "PACKAGE";
  return (
    <dl className='quote-summary' aria-live='polite'>
      {(!packageOnly || (!free && quote.taxRate === null)) && quote.lines.map((line) => (
        <div key={`${line.kind}-${line.key}`}>
          <dt>{line.label}</dt>
          <dd>{Number(line.amount) === 0 && line.kind === "PACKAGE" ? "Gratis" : rupiah(line.amount)}</dd>
        </div>
      ))}
      {!free && Number(quote.supportYearly) > 0 ? <p className='form-note'>Biaya dukungan ditagih sekali per tahun.</p> : null}
      {!free && quote.taxRate !== null ? (
        <>
          <div>
            <dt>{packageOnly ? "Harga paket" : "Subtotal"}</dt>
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
  const unitLabel = UNIT_CHOICES.find((u) => u.type === unitType)?.label ?? "";

  const pick = (pkg: Package) =>
    onChange({
      ...selection,
      packageCode: pkg.code,
      featureKeys: pkg.isCustom ? [...locked] : [],
      addons: []
    });

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
    </div>
  );
}
