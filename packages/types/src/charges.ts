// Koperasi pasar plan (docs/2026-09-26-koperasi-pasar-dev-plan.md) F5.
import type { InstallmentStatus } from "./loan.js";
import type { StallKind } from "./market.js";

export type ChargeKind = "SEWA" | "RETRIBUSI";
export type ChargePeriod = "DAILY" | "MONTHLY" | "YEARLY";

/** A pedagang's occupancy of a Stall. Creating one sets Stall.status = OCCUPIED. */
export interface StallContract {
  id: string;
  tenantId: string;
  stallId: string;
  memberId: string;
  /** `YYYY-MM-DD` */
  startDate: string;
  /** `YYYY-MM-DD` */
  endDate: string | null;
  rentAmount: string;
  rentPeriod: Extract<ChargePeriod, "MONTHLY" | "YEARLY">;
  isActive: boolean;
  createdAt: string;
}

export interface CreateStallContractRequest {
  stallId: string;
  memberId: string;
  startDate: string;
  rentAmount: number;
  rentPeriod: Extract<ChargePeriod, "MONTHLY" | "YEARLY">;
}

export interface ListStallContractsQuery {
  stallId?: string;
  memberId?: string;
  isActive?: boolean;
}

/** GET /market/contracts's shape — denormalized so the frontend needs no separate member/stall/market lookups. */
export interface StallContractSummary extends StallContract {
  memberName: string;
  stallCode: string;
  marketId: string;
  marketName: string;
}

/** A retribusi tariff for one market + stall kind. Several can be active at once (e.g. Kebersihan, Keamanan). */
export interface LevyRate {
  id: string;
  tenantId: string;
  marketId: string;
  stallKind: StallKind;
  name: string;
  amount: string;
  period: ChargePeriod;
  isActive: boolean;
  createdAt: string;
}

export interface CreateLevyRateRequest {
  marketId: string;
  stallKind: StallKind;
  name: string;
  amount: number;
  period?: ChargePeriod;
}

export type UpdateLevyRateRequest = Partial<Omit<CreateLevyRateRequest, "marketId">> & { isActive?: boolean };

/** One billed line — generated daily from an active StallContract (SEWA) or LevyRate (RETRIBUSI). */
export interface Charge {
  id: string;
  tenantId: string;
  unitId: string;
  memberId: string;
  memberName: string;
  stallId: string;
  stallCode: string;
  marketId: string;
  marketName: string;
  block: string | null;
  kind: ChargeKind;
  periodStart: string;
  dueDate: string;
  amount: string;
  paidAmount: string;
  status: InstallmentStatus;
  createdAt: string;
}

export interface ListChargesQuery {
  marketId?: string;
  block?: string;
  status?: InstallmentStatus;
  memberId?: string;
}

export interface PayChargeRequest {
  amount: number;
  note?: string;
}

export interface ChargePayment {
  id: string;
  tenantId: string;
  chargeId: string;
  amount: string;
  paidAt: string;
  createdBy: string;
  collectionBatchId: string | null;
  createdAt: string;
}
