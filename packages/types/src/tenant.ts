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
