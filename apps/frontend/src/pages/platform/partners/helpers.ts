import type { ApproveReferralPartnerInput } from "@siskop/types";
import { REFERRAL_MONTHS_MAX, REFERRAL_MONTHS_MIN, REFERRAL_RATE_MAX } from "@siskop/types";

/** "0.2000" -> "20%", "0.125" -> "12,5%". */
export function percent(rate: string): string {
  const value = Number((Number(rate) * 100).toFixed(2));
  return `${String(value).replace(".", ",")}%`;
}

export interface ApproveForm {
  code: string;
  /** Percent as typed, e.g. "30" or "12,5". Blank keeps the partner's current rate. */
  ratePercent: string;
  months: string;
}

export type ApproveResult = { ok: true; body: ApproveReferralPartnerInput } | { ok: false; problem: string };

/** Turns what the admin typed into the request, sending only what they changed. */
export function approveBody(form: ApproveForm): ApproveResult {
  const body: ApproveReferralPartnerInput = {};
  if (form.code.trim() !== "") body.code = form.code.trim();

  if (form.ratePercent.trim() !== "") {
    const pct = Number(form.ratePercent.trim().replace(",", "."));
    const max = Number(REFERRAL_RATE_MAX) * 100;
    if (!Number.isFinite(pct) || pct < 0 || pct > max) return { ok: false, problem: `Komisi harus antara 0% dan ${max}%.` };
    body.commissionRate = String(Number((pct / 100).toFixed(4)));
  }
  if (form.months.trim() !== "") {
    const months = Number(form.months.trim());
    if (!Number.isInteger(months) || months < REFERRAL_MONTHS_MIN || months > REFERRAL_MONTHS_MAX)
      return { ok: false, problem: `Masa komisi harus ${REFERRAL_MONTHS_MIN}–${REFERRAL_MONTHS_MAX} bulan.` };
    body.commissionMonths = months;
  }
  return { ok: true, body };
}

export function rejectProblem(reason: string): string | null {
  return reason.trim().length < 3 ? "Alasan penolakan wajib diisi (minimal 3 karakter)." : null;
}
