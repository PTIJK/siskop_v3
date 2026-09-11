import type { User as DbUser, Role as DbRole, UserUnit as DbUserUnit } from "@prisma/client";
import type { Permissions, User, UserRole } from "@siskop/types";

export type UserWithRole = DbUser & { role: DbRole; unitAssignments: DbUserUnit[] };

/**
 * `AuthClaims.role` (coarse, fixed) is derived here, not stored — the tenant's
 * actual RBAC role (`roleId`/`permissions`, seeded per-tenant with names like
 * "Super Admin"/"Teller") is a separate, per-tenant-customizable axis. Members
 * never log in (no `Member.userId`), so "member" is never produced here.
 */
export function deriveUserRole(user: UserWithRole): UserRole {
  if (user.isPlatformAdmin) return "super_admin";
  if (user.role.name === "Teller" || user.role.name === "Viewer") return "accountant";
  return "tenant_admin";
}

export function toPublicUser(user: UserWithRole): User {
  // Built field-by-field rather than by deleting passwordHash, so a column
  // added to the model later cannot leak by default.
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    name: user.name,
    role: deriveUserRole(user),
    roleId: user.roleId,
    roleName: user.role.name,
    permissions: user.role.permissions as unknown as Permissions,
    unitIds: user.unitAssignments.map((a) => a.unitId),
    isActive: user.isActive,
    isPlatformAdmin: user.isPlatformAdmin,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString()
  };
}
