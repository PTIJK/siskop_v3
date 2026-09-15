// `Member` deliberately carries no `userId`/login — members are managed by
// staff (tenant_admin/accountant/teller), they do not self-service log in.
// Also deliberately carries no `unitId`: a person joins the koperasi, not the
// shop. Unit participation is auto-enrolled into the tenant's sole unit via
// `UnitMembership` at creation time (no picker UI in Phase 1).
export interface Member {
  id: string;
  tenantId: string;
  memberId: string;
  accountNumber: string;
  fullName: string;
  nik: string;
  address: string;
  birthPlace: string;
  /** ISO date, e.g. `1985-03-15`. */
  birthDate: string;
  occupation: string;
  ktpPhotoUrl?: string | null;
  isActive: boolean;
  /**
   * Related-party concentration limit (Permenkop UKM 8/2023): a pengurus/
   * pengawas member's cumulative active-loan principal is capped at 10% of
   * the tenant's modalDisetor. See lib/regulatory-config.ts (backend).
   */
  isPengurus: boolean;
  isPengawas: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMemberRequest {
  fullName: string;
  nik: string;
  address: string;
  birthPlace: string;
  /** `YYYY-MM-DD` */
  birthDate: string;
  occupation: string;
  isPengurus?: boolean;
  isPengawas?: boolean;
}

export type UpdateMemberRequest = Partial<CreateMemberRequest>;

export interface ListMembersQuery {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: "fullName" | "memberId" | "createdAt";
  sortOrder?: "asc" | "desc";
  isActive?: boolean;
}

// ── Self-Service Registration ───────────────────────────────────────────────
// A prospective member's own submission via the public QR form — never
// creates a Member directly. A teller/admin reviews the queue and approves
// (which does create the Member, via the same ID-generation path as manual
// entry) or rejects it. See modules/members/registration.* (backend).

export type MemberRegistrationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface MemberRegistrationRequest {
  id: string;
  tenantId: string;
  fullName: string;
  nik: string;
  address: string;
  birthPlace: string;
  /** ISO date, e.g. `1985-03-15`. */
  birthDate: string;
  occupation: string;
  phone?: string | null;
  ktpPhotoUrl?: string | null;
  status: MemberRegistrationStatus;
  rejectionReason?: string | null;
  submittedAt: string;
  reviewedAt?: string | null;
  reviewedByUserId?: string | null;
  createdMemberId?: string | null;
}

export interface ListRegistrationRequestsQuery {
  page?: number;
  limit?: number;
  status?: MemberRegistrationStatus;
}

export interface RejectRegistrationRequestInput {
  rejectionReason: string;
}

export interface SelfRegistrationLink {
  url: string;
}

/** The shared field set — same validation rules as CreateMemberRequest,
 * minus isPengurus/isPengawas (staff-only concepts a prospect doesn't set),
 * plus the two things only the public form needs. */
export interface PublicMemberRegistrationInput {
  fullName: string;
  nik: string;
  address: string;
  birthPlace: string;
  /** `YYYY-MM-DD` */
  birthDate: string;
  occupation: string;
  phone?: string;
  captchaToken: string;
}

export interface PublicMemberRegistrationResult {
  message: string;
  /** Last 4 digits only, e.g. `************0001` — the NIK is never echoed back in full. */
  nikMasked: string;
  /** True if this NIK already belongs to a Member or another PENDING request in the tenant — informational only, never blocks submission. */
  nikWarning: boolean;
}

export interface PublicTenantBranding {
  tenantName: string;
  tenantLogoUrl: string | null;
  selfRegistrationEnabled: boolean;
}
