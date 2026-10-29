import type { CatalogSnapshot } from "./snapshot.js";

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface CatalogChange {
  section: "packages" | "features" | "volumeAddons" | "supportPlans" | "settings";
  key: string;
  type: "ADDED" | "REMOVED" | "CHANGED";
  fields?: FieldChange[];
}

type Row = Record<string, unknown>;

/** Lists whose order carries no meaning compare as sets. */
const UNORDERED = new Set(["features", "requires"]);

/** JSON with object keys sorted, because Postgres jsonb returns keys in its own order. */
function canonical(v: unknown): string {
  return JSON.stringify(v, (_key, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
      : value
  );
}

function same(field: string, a: unknown, b: unknown): boolean {
  if (UNORDERED.has(field) && Array.isArray(a) && Array.isArray(b)) {
    return canonical([...a].sort()) === canonical([...b].sort());
  }
  return canonical(a) === canonical(b);
}

function fieldChanges(before: Row, after: Row): FieldChange[] {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: FieldChange[] = [];
  for (const field of fields) {
    if (!same(field, before[field], after[field])) out.push({ field, before: before[field] ?? null, after: after[field] ?? null });
  }
  return out;
}

function diffSection(section: CatalogChange["section"], keyOf: (r: Row) => string, before: Row[], after: Row[]): CatalogChange[] {
  const b = new Map(before.map((r) => [keyOf(r), r]));
  const a = new Map(after.map((r) => [keyOf(r), r]));
  const out: CatalogChange[] = [];
  for (const [key, row] of a) {
    const old = b.get(key);
    if (!old) {
      out.push({ section, key, type: "ADDED" });
      continue;
    }
    const fields = fieldChanges(old, row);
    if (fields.length > 0) out.push({ section, key, type: "CHANGED", fields });
  }
  for (const key of b.keys()) if (!a.has(key)) out.push({ section, key, type: "REMOVED" });
  return out;
}

/** What the owner would change by publishing `after` over `before`. Empty when identical. */
export function diffCatalogs(before: CatalogSnapshot, after: CatalogSnapshot): CatalogChange[] {
  const rows = (v: unknown) => v as Row[];
  const settingFields = fieldChanges(before.settings as unknown as Row, after.settings as unknown as Row);
  return [
    ...diffSection("packages", (r) => r.code as string, rows(before.packages), rows(after.packages)),
    ...diffSection("features", (r) => r.key as string, rows(before.features), rows(after.features)),
    ...diffSection("volumeAddons", (r) => r.itemKey as string, rows(before.volumeAddons), rows(after.volumeAddons)),
    ...diffSection("supportPlans", (r) => r.code as string, rows(before.supportPlans), rows(after.supportPlans)),
    ...(settingFields.length > 0 ? [{ section: "settings" as const, key: "settings", type: "CHANGED" as const, fields: settingFields }] : [])
  ];
}
