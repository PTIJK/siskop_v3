import type { PricingCatalogFeature, PricingCatalogPackage, PricingChange } from "@siskop/types";

export { buildFeatureRows, toggleCustomFeature, type FeatureRow } from "@/lib/featureTree";

/**
 * The package's feature list after switching one feature on or off, keeping it
 * self-consistent: switching on pulls in the parent and what it requires;
 * switching off drops everything that depends on it. This mirrors the check the
 * server runs at publish, so the owner is not sent to a 422 for a click.
 */
export function toggleFeature(pkg: PricingCatalogPackage, key: string, on: boolean, features: PricingCatalogFeature[]): string[] {
  const byKey = new Map(features.map((f) => [f.key, f]));
  const selected = new Set(pkg.features);

  if (on) {
    const stack = [key];
    while (stack.length > 0) {
      const k = stack.pop() as string;
      const f = byKey.get(k);
      if (!f || selected.has(k)) continue;
      selected.add(k);
      stack.push(...f.requires, ...(f.parentKey ? [f.parentKey] : []));
    }
    return [...selected];
  }

  const removing = new Set<string>();
  const stack = [key];
  while (stack.length > 0) {
    const k = stack.pop() as string;
    if (removing.has(k)) continue;
    removing.add(k);
    for (const f of features) {
      if (f.parentKey === k || f.requires.includes(k)) stack.push(f.key);
    }
  }
  return [...selected].filter((k) => !removing.has(k));
}

export function limitLabel(value: number | null): string {
  return value === null ? "Tanpa batas" : value.toLocaleString("id-ID");
}

/**
 * Turns what an owner types ("Rp 1.500.000", "83.333,33") into the plain
 * decimal string the API takes, or null when it is not a usable amount.
 */
export function normaliseIdr(input: string): string | null {
  const text = input.replace(/rp/i, "").replace(/\s/g, "");
  if (text === "") return null;
  let plain: string;
  if (text.includes(",")) plain = text.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(text)) plain = text.replace(/\./g, "");
  else plain = text;
  return /^\d+(\.\d{1,2})?$/.test(plain) ? plain : null;
}

const SECTION_LABEL: Record<PricingChange["section"], string> = {
  packages: "Paket",
  features: "Fitur",
  volumeAddons: "Add-on volume",
  supportPlans: "Paket dukungan",
  settings: "Aturan"
};

function show(value: unknown): string {
  if (value === null || value === undefined) return "-";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function describeField(field: { field: string; before: unknown; after: unknown }): string {
  if (Array.isArray(field.before) && Array.isArray(field.after)) {
    const before = new Set(field.before.map(String));
    const after = new Set(field.after.map(String));
    const added = [...after].filter((k) => !before.has(k)).length;
    const removed = [...before].filter((k) => !after.has(k)).length;
    return `${field.field} +${added} −${removed}`;
  }
  return `${field.field} ${show(field.before)} → ${show(field.after)}`;
}

/** One line of the publish preview. */
export function describeChange(change: PricingChange): string {
  const label = SECTION_LABEL[change.section];
  if (change.type === "ADDED") return `${label} ${change.key} ditambahkan`;
  if (change.type === "REMOVED") return `${label} ${change.key} dihapus`;
  const subject = change.section === "settings" ? label : `${label} ${change.key}`;
  return `${subject}: ${(change.fields ?? []).map(describeField).join("; ")}`;
}
