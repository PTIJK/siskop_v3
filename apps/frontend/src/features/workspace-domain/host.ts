/** UI routing only. The API independently verifies host and tenant membership. */
export function tenantSlug(host = window.location.hostname): string | null {
  const base = import.meta.env.VITE_TENANT_BASE_DOMAIN;
  for (const suffix of [base, "localhost"].filter((value): value is string => Boolean(value))) {
    if (!host.endsWith(`.${suffix}`)) continue;
    const slug = host.slice(0, -(suffix.length + 1));
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(slug) ? slug : null;
  }
  return null;
}
export function canonicalWorkspaceUrl(loginUrl: string, preservePath = false): string {
  const target = new URL(loginUrl);
  const base = import.meta.env.VITE_TENANT_BASE_DOMAIN;
  const localPreview = import.meta.env.DEV && base?.endsWith(".localhost") && target.protocol === "http:" && target.port === window.location.port;
  if ((!localPreview && (target.protocol !== "https:" || target.port)) || !base || !target.hostname.endsWith(`.${base}`) ||
      target.hostname.slice(0, -(base.length + 1)).includes(".") || target.username || target.password) {
    throw new Error("Alamat workspace tidak valid.");
  }
  if (preservePath) { target.pathname = window.location.pathname; target.search = window.location.search; }
  return target.toString();
}
