export type TenantType = "SYARIAH" | "KONVENSIONAL";

export interface Tenant {
  id: string;
  name: string;
  /**
   * Hostname-safe identifier used as the login subdomain: `demo` serves
   * `demo.localhost:3000`. Resolved from the request's `Host` header
   * (`slugFromHost`), never from the request body.
   */
  slug: string;
  address: string;
  /** Official cooperative registry number, e.g. `KOP/001/DEMO/2020`. */
  registrationNo: string;
  type: TenantType;
  /** Display label (e.g. "Koperasi Simpan Pinjam") — not the same axis as CooperativeUnit.type. */
  cooperativeType: string;
  logoUrl?: string | null;
  isActive: boolean;
  createdAt: string;
}

export type DomainStatus = "PENDING" | "VERIFIED" | "FAILED";

/** A tenant's whitelabel branding config — gated behind the SubscriptionPackage.whitelabelEnabled entitlement (writes only). */
export interface WhitelabelConfig {
  id: string;
  tenantId: string;
  customDomain: string | null;
  domainStatus: DomainStatus;
  primaryColor: string | null;
  hideBranding: boolean;
  emailSenderName: string | null;
  emailSenderAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertWhitelabelConfigRequest {
  customDomain?: string | null;
  primaryColor?: string | null;
  hideBranding?: boolean;
  emailSenderName?: string | null;
  emailSenderAddress?: string | null;
}

/** Permenkop UKM No. 2/2024 Pasal 12 mandatory-audit threshold (Rp5M) compliance field. */
export interface ModalDisetorInfo {
  modalDisetor: string | null;
  auditThresholdNotifiedAt: string | null;
}

export interface UpdateModalDisetorRequest {
  modalDisetor: number | null;
}
