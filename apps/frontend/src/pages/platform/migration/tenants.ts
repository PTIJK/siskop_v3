export interface TenantOption {
  id: string;
  name: string;
  slug: string;
  registrationNo: string;
  isActive: boolean;
}

/**
 * Search over name, subdomain and registration number. Every word of the query must match somewhere
 * (any order, any case); names that start with the query come first, otherwise alphabetical.
 */
export function filterTenants<T extends TenantOption>(tenants: readonly T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = (x: T) => `${x.name} ${x.slug} ${x.registrationNo}`.toLowerCase();
  const matched = tenants.filter((x) => words.every((w) => haystack(x).includes(w)));
  const q = query.trim().toLowerCase();
  const rank = (x: T) => (q && x.name.toLowerCase().startsWith(q) ? 0 : 1);
  return [...matched].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
