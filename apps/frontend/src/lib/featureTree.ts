/** The few fields the tree helpers need, so they work for the owner console and the public catalog alike. */
export interface TreeFeature {
  key: string;
  parentKey: string | null;
  requires: string[];
  customPrice: string;
  sortOrder: number;
}

export interface FeatureRow<F extends TreeFeature> {
  feature: F;
  depth: number;
}

/** Features as a tree flattened for a list: parents before children, each level in sortOrder. */
export function buildFeatureRows<F extends TreeFeature>(features: F[]): FeatureRow<F>[] {
  const keys = new Set(features.map((f) => f.key));
  const children = new Map<string | null, F[]>();
  for (const f of [...features].sort((a, b) => a.sortOrder - b.sortOrder)) {
    // A child whose parent is missing is treated as a root so it never disappears from the list.
    const parent = f.parentKey !== null && keys.has(f.parentKey) ? f.parentKey : null;
    children.set(parent, [...(children.get(parent) ?? []), f]);
  }
  const rows: FeatureRow<F>[] = [];
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
 * The Custom builder's selection after ticking or unticking a feature. Only
 * priced features are ever in the selection (free ones come with Custom), so
 * ticking pulls in just the priced parents and requirements; unticking drops
 * everything that depends on the feature.
 */
export function toggleCustomFeature(selected: string[], key: string, on: boolean, features: TreeFeature[]): string[] {
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
