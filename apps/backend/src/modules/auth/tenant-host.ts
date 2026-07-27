/**
 * Hostnames that belong to the platform rather than to a tenant. Treating one
 * of these as a slug would send a login into a lookup that can only fail.
 */
const RESERVED = new Set(["www", "api", "admin", "app", "static", "cdn"]);

const HOSTNAME_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Extracts the tenant slug from a request's Host header.
 *
 * `demo.localhost:3000` -> `demo`, `localhost:3000` -> `null`. Returns null
 * whenever the host carries no tenant subdomain, so callers must treat null as
 * "tenant not identified" rather than falling back to some default tenant —
 * a default would be a cross-tenant data leak waiting to happen.
 */
export function slugFromHost(host: string | undefined): string | null {
  if (!host) return null;

  // Strip the port. Bracketed IPv6 literals ("[::1]:3000") have no subdomain
  // by construction, so they are rejected before the split.
  if (host.startsWith("[")) return null;
  const hostname = host.split(":")[0]?.toLowerCase();
  if (!hostname) return null;

  // An IPv4 literal's leading label is a number, not a slug.
  if (/^\d+(\.\d+)*$/.test(hostname)) return null;

  const labels = hostname.split(".");
  if (labels.length < 2) return null;

  const slug = labels[0];
  if (!slug || !HOSTNAME_LABEL.test(slug) || RESERVED.has(slug)) return null;

  return slug;
}
