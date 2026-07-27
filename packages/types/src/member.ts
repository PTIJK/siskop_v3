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

export interface CreateMemberRequest {
  name: string;
  email: string;
  phone: string;
  address: string;
  membershipId: string;
}

export interface ListMembersQuery {
  page?: number;
  limit?: number;
  status?: MemberStatus;
  search?: string;
}
