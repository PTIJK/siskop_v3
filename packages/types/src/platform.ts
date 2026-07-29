import type { Tenant, TenantType } from "./tenant";
import type { CooperativeType } from "./unit";
import type { User } from "./user";

/** Platform-admin-only view of a tenant — GET /api/platform/tenants. */
export interface PlatformTenantSummary extends Tenant {
  unitCount: number;
  userCount: number;
  packageId: string | null;
  packageName: string | null;
  nextBillingDate: string | null;
}

/**
 * Platform admin provisioning a new koperasi (tenant) from outside any tenant.
 * Unlike self-service registration (`RegisterTenantRequest`), the caller here
 * is already authenticated as a platform admin — this is POST /api/platform/tenants.
 */
export interface CreateTenantRequest {
  tenantName: string;
  slug: string;
  registrationNo: string;
  address: string;
  type: TenantType;
  cooperativeType?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  firstUnit: { type: CooperativeType; name: string };
}

/** Platform admin toggling a tenant's active status and/or subscription package. */
export interface UpdateTenantStatusRequest {
  isActive?: boolean;
  packageId?: string | null;
  nextBillingDate?: string | null;
}

/** Names the modules a SubscriptionPackage additionally entitles a tenant to. Base modules
 * (Members/Savings/Loans/Dashboard/plain Reports) are never gated by a package. */
export type EntitlementModule = "accounting";

export interface SubscriptionPackage {
  id: string;
  name: string;
  /** Rupiah, per billing period — a Decimal on the wire, same convention as other money fields. */
  price: string;
  modules: EntitlementModule[];
  maxUsers: number;
  maxMembers: number;
  maxSavingConfigs: number | null;
  whitelabelEnabled: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface CreatePackageRequest {
  name: string;
  price: number;
  modules: EntitlementModule[];
  maxUsers: number;
  maxMembers: number;
  maxSavingConfigs?: number | null;
  whitelabelEnabled?: boolean;
}

export type UpdatePackageRequest = Partial<CreatePackageRequest> & { isActive?: boolean };

export interface CreatePlatformAdminRequest {
  name: string;
  email: string;
  password: string;
}

export interface UpdatePlatformAdminRequest {
  name?: string;
  email?: string;
  isActive?: boolean;
}

/** A platform admin is a User row with isPlatformAdmin=true — see modules/platform/service.ts. */
export type PlatformAdmin = User;
