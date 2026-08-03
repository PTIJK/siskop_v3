import type { Permissions } from "./role";
import type { TenantType } from "./tenant";

export type UserRole = "super_admin" | "tenant_admin" | "accountant" | "member";

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  /** Coarse role, derived at login from `isPlatformAdmin`/`role.name` — not a stored column. */
  role: UserRole;
  /** The tenant-scoped `Role` row this user has — see `role.ts`. */
  roleId: string;
  /** Display name of that Role row, e.g. "Super Admin"/"Teller" — for UI chrome only. */
  roleName: string;
  permissions: Permissions;
  isActive: boolean;
  isPlatformAdmin: boolean;
  createdAt: string;
  updatedAt: string;
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

/**
 * The refresh token is deliberately absent here — it travels only in an
 * httpOnly cookie (see backend modules/auth/refresh-cookie.ts) so client-side
 * JS, and therefore an XSS payload, can never read it.
 */
export interface LoginResponse {
  accessToken: string;
  user: User;
}

/**
 * Creates the tenant, its first unit, its 4 seed roles (Super Admin/Manager/
 * Teller/Viewer), and the admin user (assigned Super Admin) in one transaction.
 */
export interface RegisterTenantRequest {
  tenantName: string;
  slug: string;
  registrationNo: string;
  address: string;
  type: TenantType;
  adminName: string;
  adminEmail: string;
  password: string;
  firstUnit: { type: string; name: string };
}

/** Config > Pengguna: creates a tenant staff login. Members never appear here — see Member. */
export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  roleId: string;
}

export type UpdateUserRequest = Partial<{
  name: string;
  email: string;
  roleId: string;
  isActive: boolean;
}>;

/** Self-service profile edit — no password/role/isActive here, see ChangePasswordRequest. */
export interface UpdateProfileRequest {
  name: string;
  email: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Same rationale as `LoginResponse` — the rotated refresh token rides the cookie, not this body. */
export interface RefreshResponse {
  accessToken: string;
}

/**
 * JWT access-token payload. `unitIds`/`permissions` are baked in for
 * performance (avoids a DB round trip per request) — the tradeoff is that a
 * unit-access or permission change takes up to `JWT_EXPIRES_IN` to propagate.
 * Refresh tokens carry identity only and re-derive all of this on refresh.
 */
export interface AuthClaims {
  userId: string;
  tenantId: string;
  role: UserRole;
  unitIds: string[];
  roleId: string;
  permissions: Permissions;
}
