export const CooperativeType = {
  KSP: "KSP",
  KONSUMEN: "KONSUMEN",
  PRODUSEN: "PRODUSEN",
  JASA: "JASA",
  PEMASARAN: "PEMASARAN"
} as const;

export type CooperativeType = (typeof CooperativeType)[keyof typeof CooperativeType];

export interface CooperativeUnit {
  id: string;
  tenantId: string;
  type: CooperativeType;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UnitMembership {
  id: string;
  memberId: string;
  unitId: string;
  joinedAt: string;
}

// A koperasi serba usaha is a tenant with two or more active units, not a sixth
// CooperativeType. Deriving it here keeps the type information in one place and
// keeps `if (type === 'KSU')` out of reporting, SHU distribution, and RBAC.
export function isMultiUnit(units: readonly CooperativeUnit[]): boolean {
  return units.filter((u) => u.isActive).length > 1;
}
