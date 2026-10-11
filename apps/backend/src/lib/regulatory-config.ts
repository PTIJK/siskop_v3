import { Prisma } from "@prisma/client";
import { ErrorCode, type EquityClass, type KspClass } from "@siskop/types";
import { AppError } from "./errors.js";

/**
 * Source: Permenkop UKM No. 8/2023, Pasal 26 (simpanan) & Pasal 27 (pinjaman).
 * Recheck these if Kemenkop UKM revises the regulation.
 */
export const REGULATORY_CAPS = {
  LOAN_ANNUAL_RATE_MAX_PCT: 24,
  SAVING_ANNUAL_RATE_MAX_PCT: 9,
  /** BMPP pihak terkait (pengurus, pengawas) — Permenkop UKM 8/2023 Pasal 44. */
  RELATED_PARTY_LOAN_CONCENTRATION_PCT: 10,
  /** BMPP pihak tidak terkait (other members) — Pasal 45. */
  NON_RELATED_PARTY_LOAN_CONCENTRATION_PCT: 15
} as const;

/**
 * Equity classes that make up Modal Sendiri — Permenkop UKM 8/2023 Pasal 1
 * angka 23 (simpanan pokok, simpanan wajib, dana cadangan, hibah) plus angka 24
 * (Modal Tetap of a USP). Modal Penyertaan, SHU not yet allocated and other
 * equity are deliberately excluded.
 */
export const MODAL_SENDIRI_CLASSES: readonly EquityClass[] = [
  "SIMPANAN_POKOK",
  "SIMPANAN_WAJIB",
  "MODAL_TETAP",
  "CADANGAN_UMUM",
  "CADANGAN_RISIKO",
  "HIBAH"
];

/**
 * Permenkop UKM No. 2/2024 Pasal 12: a koperasi whose modal disetor reaches
 * Rp5 miliar must be audited by a registered public accountant. Rp5 *miliar*,
 * not Rp5 juta — the original "Rp5M" shorthand was once misread as million.
 * A reminder threshold only, never enforced.
 */
export const MODAL_DISETOR_AUDIT_THRESHOLD_RP = new Prisma.Decimal("5000000000");

export function isModalDisetorAuditRequired(modalDisetor: Prisma.Decimal | null): boolean {
  return modalDisetor !== null && modalDisetor.gte(MODAL_DISETOR_AUDIT_THRESHOLD_RP);
}

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
 * would exceed 10% of the tenant's Modal Sendiri (Permenkop UKM 8/2023 Pasal
 * 44 — see modules/reports/capital-service.ts#getModalSendiri). No-op for
 * non-related-party members. With no Modal Sendiri yet (0), a related-party
 * member cannot borrow anything. Decimal math
 * throughout, so the cap boundary is exact to the sen.
 */
export function validateRelatedPartyLoanLimit(params: {
  isRelatedParty: boolean;
  existingActivePrincipal: Prisma.Decimal.Value;
  newPrincipal: Prisma.Decimal.Value;
  modalSendiri: Prisma.Decimal.Value;
}): void {
  if (!params.isRelatedParty) return;

  const cap = new Prisma.Decimal(params.modalSendiri)
    .mul(REGULATORY_CAPS.RELATED_PARTY_LOAN_CONCENTRATION_PCT)
    .div(100);
  const combined = new Prisma.Decimal(params.existingActivePrincipal).add(params.newPrincipal);
  if (combined.gt(cap)) {
    throw new AppError(
      ErrorCode.RELATED_PARTY_LIMIT_EXCEEDED,
      `Total pinjaman pengurus/pengawas melebihi batas ${REGULATORY_CAPS.RELATED_PARTY_LOAN_CONCENTRATION_PCT}% dari modal sendiri`
    );
  }
}

/**
 * Upper bounds of KSP I-III — Permenkop UKM 8/2023 Pasal 49: jumlah anggota,
 * Modal Sendiri and/or aset. Above KSP III is KSP IV.
 */
const KSP_CLASS_BOUNDS: { class: KspClass; members: number; modalSendiri: string; aset: string }[] = [
  { class: "KSP_I", members: 5_000, modalSendiri: "2500000000", aset: "15000000000" },
  { class: "KSP_II", members: 10_000, modalSendiri: "15000000000", aset: "100000000000" },
  { class: "KSP_III", members: 30_000, modalSendiri: "50000000000", aset: "500000000000" }
];

/**
 * The koperasi's KSP class under Pasal 49. The criteria are joined by
 * "dan/atau", so any one of them exceeding a class's bound lifts it to the
 * next: the result is the highest class any criterion lands in.
 */
export function classifyKsp(input: { members: number; modalSendiri: Prisma.Decimal.Value; aset: Prisma.Decimal.Value }): KspClass {
  const modalSendiri = new Prisma.Decimal(input.modalSendiri);
  const aset = new Prisma.Decimal(input.aset);
  for (const bound of KSP_CLASS_BOUNDS) {
    if (input.members <= bound.members && modalSendiri.lte(bound.modalSendiri) && aset.lte(bound.aset)) {
      return bound.class;
    }
  }
  return "KSP_IV";
}
