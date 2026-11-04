// Referral partner program. Platform-level: only platform admins see these
// shapes, except the public code check and the partner application.
// Money and rates are decimal strings; a rate is a fraction ("0.2000" = 20%).

export type ReferralPartnerStatus = "PENDING" | "ACTIVE" | "SUSPENDED" | "REJECTED";
export type ReferralPartnerSource = "APPLICATION" | "ADMIN";
export type TenantReferralSource = "REGISTRATION" | "ADMIN";
export type ReferralCommissionStatus = "ACCRUED" | "PAID" | "VOID";
export type ReferralPayoutStatus = "DRAFT" | "PAID" | "CANCELLED";

/** GET /api/onboarding/referral/:code — never reveals more than the display name. */
export interface ReferralCodeCheck {
  valid: boolean;
  partnerName: string | null;
}

/** POST /api/partners/apply */
export interface ReferralPartnerApplicationInput {
  name: string;
  email: string;
  phone: string;
  city?: string;
  province?: string;
  ktpNo: string;
  npwp?: string;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  salesPlan?: string;
  termsVersion: string;
  acceptTerms: true;
}

export interface ReferralPartnerSummary {
  id: string;
  code: string | null;
  name: string;
  email: string;
  phone: string;
  status: ReferralPartnerStatus;
  source: ReferralPartnerSource;
  commissionRate: string;
  commissionMonths: number;
  referredTenants: number;
  /** Sum of paid invoice subtotals from referred koperasi. */
  referredRevenue: string;
  commissionAccrued: string;
  commissionPaid: string;
  /** Accrued and not yet in a paid payout. */
  commissionOutstanding: string;
  createdAt: string;
}

export interface ReferralPartnerDetail extends ReferralPartnerSummary {
  city: string | null;
  province: string | null;
  ktpNo: string;
  npwp: string | null;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  salesPlan: string | null;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  rejectReason: string | null;
  reviewedAt: string | null;
  notes: string | null;
  referrals: TenantReferralRow[];
  commissions: ReferralCommissionRow[];
  payouts: ReferralPayoutRow[];
}

export interface TenantReferralRow {
  id: string;
  tenant: { id: string; name: string; slug: string; isActive: boolean };
  codeUsed: string;
  rate: string;
  months: number;
  attributedAt: string;
  windowEndsAt: string;
  source: TenantReferralSource;
  flaggedSelfReferral: boolean;
}

export interface ReferralCommissionRow {
  id: string;
  tenant: { id: string; name: string };
  invoice: { id: string; number: string; type: string };
  baseAmount: string;
  rate: string;
  amount: string;
  status: ReferralCommissionStatus;
  voidReason: string | null;
  payoutId: string | null;
  accruedAt: string;
}

export interface ReferralPayoutRow {
  id: string;
  number: string;
  partner: { id: string; name: string; code: string | null };
  periodEnd: string;
  grossAmount: string;
  taxWithheld: string;
  netAmount: string;
  status: ReferralPayoutStatus;
  transferRef: string | null;
  paidAt: string | null;
  commissionCount: number;
  createdAt: string;
}

export interface CreateReferralPartnerInput extends Omit<ReferralPartnerApplicationInput, "termsVersion" | "acceptTerms"> {
  /** Vanity code (e.g. NEX-BUDI); generated when omitted. */
  code?: string;
  commissionRate?: string;
  commissionMonths?: number;
  notes?: string;
}

export interface UpdateReferralPartnerInput {
  name?: string;
  email?: string;
  phone?: string;
  city?: string | null;
  province?: string | null;
  npwp?: string | null;
  bankName?: string;
  bankAccountNo?: string;
  bankAccountName?: string;
  notes?: string | null;
  status?: "ACTIVE" | "SUSPENDED";
  commissionRate?: string;
  commissionMonths?: number;
  /** Required when the rate, months or status changes. */
  reason?: string;
}

export interface ApproveReferralPartnerInput {
  code?: string;
  commissionRate?: string;
  commissionMonths?: number;
}

export interface RejectReferralPartnerInput {
  reason: string;
}

export interface AssignTenantReferralInput {
  partnerId: string;
  reason: string;
}

export interface UpdateTenantReferralInput {
  rate?: string;
  months?: number;
  reason: string;
}

export interface ReferralSettings {
  defaultRate: string;
  defaultMonths: number;
}

export interface UpdateReferralSettingsInput extends ReferralSettings {
  reason: string;
}

export interface VoidReferralCommissionInput {
  reason: string;
}

export interface CreateReferralPayoutInput {
  partnerId: string;
  periodEnd: string;
}

export interface MarkReferralPayoutPaidInput {
  transferRef: string;
  paidAt?: string;
  taxWithheld?: string;
}

/** Bounds an admin may set; enforced server-side. */
export const REFERRAL_RATE_MAX = "0.5";
export const REFERRAL_MONTHS_MIN = 1;
export const REFERRAL_MONTHS_MAX = 60;
