/** One namespace for all tenant addresses; never accept a destination URL from input. */
export function tenantBaseDomain(): string | null {
  const value = process.env.TENANT_BASE_DOMAIN?.trim().toLowerCase();
  if (!value) return null;
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(value)) {
    throw new Error("Invalid TENANT_BASE_DOMAIN");
  }
  return value;
}
export function tenantDomainsEnabled(): boolean {
  return process.env.TENANT_DOMAINS_ENABLED === "true" && tenantBaseDomain() !== null;
}
export function tenantLoginUrl(slug: string): string {
  if (tenantDomainsEnabled() && process.env.NODE_ENV !== "production" && tenantBaseDomain()!.endsWith(".localhost")) {
    const port = process.env.TENANT_DEV_PORT;
    if (!port || !/^\d{1,5}$/.test(port)) throw new Error("TENANT_DEV_PORT required for local tenant previews");
    return `http://${slug}.${tenantBaseDomain()}:${port}/login`;
  }
  return tenantDomainsEnabled()
    ? `https://${slug}.${tenantBaseDomain()}/login`
    : new URL("/login", process.env.PUBLIC_APP_URL ?? "http://localhost:3000").toString();
}
