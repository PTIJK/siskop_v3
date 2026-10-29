import type { PricingCatalogFeature, PricingCatalogPackage, PricingChange } from "@siskop/types";

export interface FeatureRow {
  feature: PricingCatalogFeature;
  depth: number;
}

/** Features as a tree flattened for a table: parents before children, each level in sortOrder. */
export function buildFeatureRows(features: PricingCatalogFeature[]): FeatureRow[] {
  const bySort = (a: PricingCatalogFeature, b: PricingCatalogFeature) => a.sortOrder - b.sortOrder;
  const keys = new Set(features.map((f) => f.key));
  const children = new Map<string | null, PricingCatalogFeature[]>();
  for (const f of [...features].sort(bySort)) {
    // A child whose parent is missing is treated as a root so it never disappears from the grid.
    const parent = f.parentKey !== null && keys.has(f.parentKey) ? f.parentKey : null;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  const rows: FeatureRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const f of children.get(parent) ?? []) {
      rows.push({ feature: f, depth });
      walk(f.key, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

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

/**
 * The Custom builder's selection after ticking or unticking a feature. Only
 * priced features are ever in the selection (free ones come with Custom), so
 * ticking pulls in just the priced parents and requirements; unticking drops
 * everything that depends on the feature.
 */
export function toggleCustomFeature(selected: string[], key: string, on: boolean, features: PricingCatalogFeature[]): string[] {
  const byKey = new Map(features.map((f) => [f.key, f]));
  const next = new Set(selected);

  if (on) {
    const stack = [key];
    while (stack.length > 0) {
      const k = stack.pop() as string;
      const f = byKey.get(k);
      if (!f || Number(f.customPrice) === 0 || next.has(k)) continue;
      next.add(k);
      stack.push(...f.requires, ...(f.parentKey ? [f.parentKey] : []));
    }
    return [...next];
  }

  const removing = new Set<string>();
  const stack = [key];
  while (stack.length > 0) {
    const k = stack.pop() as string;
    if (removing.has(k)) continue;
    removing.add(k);
    for (const f of features) if (f.parentKey === k || f.requires.includes(k)) stack.push(f.key);
  }
  return [...next].filter((k) => !removing.has(k));
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
