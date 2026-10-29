import type { BillingCycle, OnboardingRegistration, PricingSelection, PublicPricingCatalog } from "@siskop/types";

type Package = PublicPricingCatalog["packages"][number];

/**
 * The business types self-registration offers. Pasar management is a JASA unit,
 * so "Koperasi pasar" is JASA. Produsen and Pemasaran have no feature in the
 * package matrix, so they are not offered here.
 */
export type UnitChoiceType = "KSP" | "KONSUMEN" | "JASA";

export const UNIT_CHOICES: { type: UnitChoiceType; label: string; hint: string; unitName: string; feature: string | null }[] = [
  { type: "KSP", label: "Simpan pinjam", hint: "Simpanan dan pinjaman anggota.", unitName: "Simpan pinjam", feature: null },
  { type: "KONSUMEN", label: "Konsumen", hint: "Toko atau waserda untuk anggota.", unitName: "Konsumen", feature: "unit_konsumen" },
  { type: "JASA", label: "Pasar", hint: "Pengelolaan pasar, kios, dan retribusi.", unitName: "Pengelola pasar", feature: "unit_pasar" }
];

const choice = (type: UnitChoiceType) => UNIT_CHOICES.find((c) => c.type === type) as (typeof UNIT_CHOICES)[number];

/** Whether a package that grants `features` can host this business type. The server checks the same rule. */
export function unitAllowed(type: UnitChoiceType, features: readonly string[]): boolean {
  const need = choice(type).feature;
  return need === null || features.includes(need);
}

/** What a Custom selection must carry for this business type. */
export function requiredCustomFeatures(type: UnitChoiceType): string[] {
  const need = choice(type).feature;
  return need === null ? [] : [need];
}

export function priceOf(pkg: Package, cycle: BillingCycle): string | null {
  return cycle === "MONTHLY" ? pkg.priceMonthly : pkg.priceYearly;
}

/** Percent saved by paying a year at once instead of twelve months; null when there is no price to compare. */
export function yearlySaving(pkg: Package): number | null {
  if (pkg.priceMonthly === null || pkg.priceYearly === null) return null;
  const twelve = Number(pkg.priceMonthly) * 12;
  return twelve <= 0 ? null : Math.round(((twelve - Number(pkg.priceYearly)) / twelve) * 100);
}

/** Reads /register?package=small&cycle=yearly, keeping only what the published catalog actually offers. */
export function parseDeepLink(
  params: URLSearchParams,
  catalog: PublicPricingCatalog
): { packageCode: string | null; cycle: BillingCycle | null } {
  const code = params.get("package");
  const pkg = catalog.packages.find((p) => p.code === code);
  const packageCode = pkg && (!pkg.isCustom || catalog.settings.customEnabled) ? pkg.code : null;
  const cycle = params.get("cycle")?.toUpperCase();
  const enabled = catalog.settings.enabledCycles.find((c) => c === cycle) ?? null;
  return { packageCode, cycle: enabled };
}

export function startingSelection(
  catalog: PublicPricingCatalog,
  link: { packageCode: string | null; cycle: BillingCycle | null }
): PricingSelection {
  const fallback = catalog.packages.find((p) => p.code === catalog.settings.defaultPackageCode) ?? catalog.packages[0];
  return {
    packageCode: link.packageCode ?? fallback?.code ?? "",
    billingCycle: link.cycle ?? catalog.settings.enabledCycles[0] ?? "MONTHLY",
    featureKeys: [],
    addons: []
  };
}

export interface RegistrationForm {
  tenantName: string;
  registrationNo: string;
  type: "KONVENSIONAL" | "SYARIAH";
  address: string;
  unitType: UnitChoiceType;
  adminName: string;
  method: "password" | "google";
  email: string;
  password: string;
  confirmPassword: string;
}

/** What is wrong with a wizard step, in the user's words. Empty means the step may continue. */
export function stepProblems(step: 1 | 2 | 3 | 4, form: RegistrationForm, quote: { effectiveFeatures: readonly string[] }): string[] {
  const problems: string[] = [];
  if (step === 1) {
    if (form.tenantName.trim().length < 2) problems.push("Nama koperasi wajib diisi (minimal 2 karakter).");
    if (form.registrationNo.trim() === "") problems.push("Nomor badan hukum wajib diisi.");
    if (form.address.trim().length < 5) problems.push("Alamat koperasi minimal 5 karakter.");
  }
  if (step === 3 && !unitAllowed(form.unitType, quote.effectiveFeatures)) {
    problems.push(`Paket ini tidak mencakup unit ${choice(form.unitType).label}. Pilih paket yang mencakupnya.`);
  }
  if (step === 4) {
    if (form.adminName.trim().length < 2) problems.push("Nama pengelola wajib diisi (minimal 2 karakter).");
    if (form.method === "password") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) problems.push("Email pengelola tidak valid.");
      if (form.password.length < 8) problems.push("Kata sandi minimal 8 karakter.");
      else if (form.password !== form.confirmPassword) problems.push("Konfirmasi kata sandi belum cocok.");
    }
  }
  return problems;
}

/** The request body: a package selection and the koperasi's details. No amount is ever sent. */
export function buildRegistration(form: RegistrationForm, selection: PricingSelection, idToken: string): OnboardingRegistration {
  return {
    subscription: selection,
    tenantName: form.tenantName.trim(),
    registrationNo: form.registrationNo.trim(),
    address: form.address.trim(),
    type: form.type,
    adminName: form.adminName.trim(),
    firstUnit: { type: form.unitType, name: choice(form.unitType).unitName },
    idToken
  };
}

/** "0.1100" -> "11%", "0.115" -> "11,5%"; null when the owner has set no VAT. */
export function formatTaxRate(rate: string | null): string | null {
  if (rate === null) return null;
  return `${(Number(rate) * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
}
