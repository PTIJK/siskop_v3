export interface WorkspaceContext {
  tenantId: string;
  name: string;
  slug: string;
  canonicalLoginUrl: string;
  isAlias: boolean;
}
export interface TenantDomainSettings {
  slug: string;
  loginUrl: string;
  baseDomain: string | null;
  enabled: boolean;
  entitled: boolean;
  canRename: boolean;
  blockedReason: "unavailable" | "inactive" | "package" | "cooldown" | "permission" | null;
  nextChangeAt: string | null;
  history: { oldSlug: string; newSlug: string; changedAt: string }[];
}
export interface RenameTenantDomainRequest { slug: string; idToken: string }
