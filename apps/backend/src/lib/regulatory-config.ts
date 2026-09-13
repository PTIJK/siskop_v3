import { ErrorCode } from "@siskop/types";
import { AppError } from "./errors.js";

/**
 * Source: Permenkop UKM No. 8/2023, Pasal 26 (simpanan) & Pasal 27 (pinjaman).
 * Recheck these if Kemenkop UKM revises the regulation.
 */
export const REGULATORY_CAPS = {
  LOAN_ANNUAL_RATE_MAX_PCT: 24,
  SAVING_ANNUAL_RATE_MAX_PCT: 9,
  RELATED_PARTY_LOAN_CONCENTRATION_PCT: 10
} as const;

/** Throws RATE_EXCEEDS_REGULATORY_CAP if `rate` (annual %) exceeds the legal cap for `kind`. */
export function validateRegulatoryRate(kind: "LOAN" | "SAVING", rate: number): void {
  const max =
    kind === "LOAN" ? REGULATORY_CAPS.LOAN_ANNUAL_RATE_MAX_PCT : REGULATORY_CAPS.SAVING_ANNUAL_RATE_MAX_PCT;
  if (rate > max) {
    throw new AppError(
      ErrorCode.RATE_EXCEEDS_REGULATORY_CAP,
      `Rate melebihi batas regulasi ${max}%/tahun (Permenkop UKM 8/2023)`
    );
  }
}

/**
 * Throws RELATED_PARTY_LIMIT_EXCEEDED if a pengurus/pengawas member's
 * cumulative active-loan principal (existing + the loan being requested)
 * would exceed 10% of the tenant's modalDisetor. No-op for non-related-party
 * members. A tenant with no modalDisetor declared yet is treated as 0 — a
 * related-party member cannot borrow anything until it is set.
 */
export function validateRelatedPartyLoanLimit(params: {
  isRelatedParty: boolean;
  existingActivePrincipal: number;
  newPrincipal: number;
  modalDisetor: number;
}): void {
  if (!params.isRelatedParty) return;

  const cap = (REGULATORY_CAPS.RELATED_PARTY_LOAN_CONCENTRATION_PCT / 100) * params.modalDisetor;
  const combined = params.existingActivePrincipal + params.newPrincipal;
  if (combined > cap) {
    throw new AppError(
      ErrorCode.RELATED_PARTY_LIMIT_EXCEEDED,
      `Total pinjaman pengurus/pengawas melebihi batas ${REGULATORY_CAPS.RELATED_PARTY_LOAN_CONCENTRATION_PCT}% dari modal disetor`
    );
  }
}
