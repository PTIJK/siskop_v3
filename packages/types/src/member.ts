export type MemberStatus = "active" | "inactive" | "suspended";

export interface Member {
  id: string;
  tenantId: string;
  userId: string;
  membershipId: string;
  status: MemberStatus;
  joinDate: string;
  phone: string;
  address: string;
  createdAt: string;
  updatedAt: string;
}

// `Member` deliberately carries no `unitId`: a person joins the koperasi, not
// the shop. Unit participation lives in `UnitMembership` — `unitIds` enrols
// them at creation, `ListMembersQuery.unitId` filters by participation.
export interface CreateMemberRequest {
  name: string;
  email: string;
  phone: string;
  address: string;
  membershipId: string;
  unitIds: string[];
}

export interface ListMembersQuery {
  page?: number;
  limit?: number;
  unitId?: string;
  status?: MemberStatus;
  search?: string;
}
