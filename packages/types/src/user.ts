import type { Permissions } from "./role";
import type { TenantType } from "./tenant";

export type UserRole = "super_admin" | "tenant_admin" | "accountant" | "member";

export interface User {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  /** Firebase manages credentials when set. Older staff accounts use local bcrypt. */
  authProvider?: string | null;
  /** Coarse role, derived at login from `isPlatformAdmin`/`role.name` — not a stored column. */
  role: UserRole;
  /** The tenant-scoped `Role` row this user has — see `role.ts`. */
  roleId: string;
  /** Display name of that Role row, e.g. "Super Admin"/"Teller" — for UI chrome only. */
  roleName: string;
  permissions: Permissions;
  /**
   * Explicit unit scoping — empty means "no explicit assignment", which
   * resolves to every active unit in the tenant (see backend
   * lib/unit-access.ts#getEffectiveUnitIds). Not the same axis as
   * `permissions`: this is *which* CooperativeUnit rows, that is *which*
   * actions.
   */
  unitIds: string[];
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

/**
 * Config > Pengguna: creates a tenant staff login. Members never appear here
 * — see Member. `unitIds` is required (min 1) here specifically: this is the
 * one path that can produce a genuinely unit-scoped user (e.g. a Toko-only
 * Kasir) — see `User.unitIds`'s doc comment.
 */
export interface CreateUserRequest {
  name: string;
  email: string;
  password: string;
  roleId: string;
  unitIds: string[];
}

export type UpdateUserRequest = Partial<{
  name: string;
  email: string;
  roleId: string;
  isActive: boolean;
  /** When provided, replaces the user's unit assignment set entirely (never an empty array — that would fall back to "all units", the opposite of a revoke; use `isActive: false` to fully revoke instead). */
  unitIds: string[];
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

// ── MEMBER PORTAL (mobile self-service) ────────────────────────────────────
// A cooperative Member's own read-only login — entirely separate from staff
// AuthClaims above (different shape, different JWT, different middleware).
// See backend modules/member-auth and modules/member-portal.

/** JWT payload for a member's own session — deliberately has no `permissions`/`unitIds`. */
export interface MemberAuthClaims {
  memberId: string;
  tenantId: string;
  role: "member";
}

/** The member types their NIK, not an email — Member has no email field. */
export interface MemberLoginRequest {
  nik: string;
  password: string;
}

/** Safe subset of Member exposed to the member themself — no nik/ktpPhotoUrl/passwordHash. */
export interface MemberProfile {
  id: string;
  memberId: string;
  accountNumber: string;
  fullName: string;
  mustChangePassword: boolean;
}

export interface MemberLoginResponse {
  accessToken: string;
  member: MemberProfile;
}

export interface MemberRefreshResponse {
  accessToken: string;
}

export interface ChangeMemberPasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Staff-triggered activation/reset of a member's portal access — see members/routes.ts. */
export interface PortalAccessResponse {
  defaultPassword: string;
  mustChangePassword: true;
}
