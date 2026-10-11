// Koperasi pasar plan (docs/2026-09-26-koperasi-pasar-dev-plan.md) F3.
export type StallKind = "KIOS" | "LOS" | "LAPAK";
export type StallStatus = "AVAILABLE" | "OCCUPIED" | "INACTIVE";

/** A pasar the koperasi manages. `unitId` is always server-resolved (the tenant's JASA unit). */
export interface Market {
  id: string;
  tenantId: string;
  unitId: string;
  name: string;
  address: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface CreateMarketRequest {
  name: string;
  address?: string;
}

export type UpdateMarketRequest = Partial<CreateMarketRequest> & { isActive?: boolean };

export interface Stall {
  id: string;
  tenantId: string;
  marketId: string;
  code: string;
  block: string | null;
  kind: StallKind;
  /** Decimal(8,2), serialized as a string over the wire. */
  areaM2: string | null;
  status: StallStatus;
}

export interface CreateStallRequest {
  marketId: string;
  code: string;
  block?: string;
  kind: StallKind;
  areaM2?: number;
}

export type UpdateStallRequest = Partial<Omit<CreateStallRequest, "marketId">>;

export interface ListStallsQuery {
  marketId?: string;
  block?: string;
  status?: StallStatus;
}
