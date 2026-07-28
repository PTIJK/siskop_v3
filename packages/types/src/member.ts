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
