// Tenant-scoped custom role with a JSON permissions blob, ported from the
// pre-rescaffold system. Every tenant is seeded with 4 roles at provisioning
// time (Super Admin/Manager/Teller/Viewer) — see `tenants/provision.ts`. This
// is orthogonal to `AuthClaims.role` (the coarse, fixed UserRole used for
// unit-access/platform gating): `Permissions` is the fine-grained axis the
// ported KSP modules check via `requirePermission(module, action)`.
// Every action is optional: a role's blob only sets the actions it actually
// grants (see SEED_ROLES in tenants/provision.ts) — an absent key means "not
// granted", not an invalid role.
export interface ModulePermissions {
  create?: boolean;
  read?: boolean;
  update?: boolean;
  delete?: boolean;
  export?: boolean;
}

export interface Permissions {
  dashboard: ModulePermissions;
  members: ModulePermissions;
  savings: ModulePermissions;
  loans: ModulePermissions;
  reports: ModulePermissions;
  config: ModulePermissions;
  users: ModulePermissions;
  roles: ModulePermissions;
  accounting?: ModulePermissions;
}

export type PermissionModule = keyof Permissions;
export type PermissionAction = "create" | "read" | "update" | "delete" | "export";

export interface Role {
  id: string;
  tenantId: string;
  name: string;
  permissions: Permissions;
  createdAt: string;
}
