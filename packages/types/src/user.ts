export type UserRole = "super_admin" | "tenant_admin" | "accountant" | "member";

export interface User {
  id: string;
  tenantId: string;
  email: string;
  phone: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthClaims {
  userId: string;
  tenantId: string;
  role: UserRole;
  unitIds: string[];
}

/**
 * The tenant is resolved from the request's subdomain, never from this body —
 * `demo.localhost` selects the tenant whose `slug` is `demo`. Email is only
 * unique *within* a tenant (`@@unique([tenantId, email])`), so a credential
 * pair alone is ambiguous across tenants.
 */
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/** Creates the tenant, its first unit, and the admin user in one transaction. */
export interface RegisterTenantRequest {
  tenantName: string;
  slug: string;
  cooperativeId: string;
  address: string;
  /**
   * The cooperative's official contact address, globally unique. Distinct from
   * `adminEmail`, which is a person's login and is unique only within the
   * tenant — one person may administer two koperasi. Defaults to `adminEmail`.
   */
  tenantEmail?: string;
  adminName: string;
  adminEmail: string;
  adminPhone: string;
  password: string;
  firstUnit: { type: string; name: string };
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
}
