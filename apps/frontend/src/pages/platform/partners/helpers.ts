import type {
  ApproveReferralPartnerInput,
  CreateReferralPartnerInput,
  UpdateReferralPartnerInput,
  UpdateReferralSettingsInput,
  UpdateTenantReferralInput
} from "@siskop/types";
import { REFERRAL_MONTHS_MAX, REFERRAL_MONTHS_MIN, REFERRAL_RATE_MAX } from "@siskop/types";
import { applicationProblems, buildApplication, EMPTY_APPLICATION } from "@/features/onboarding/partner";

type Parsed<T> = { ok: true; value: T } | { ok: false; problem: string };
export type Result<T> = { ok: true; body: T } | { ok: false; problem: string };

/** "0.2000" -> "20%", "0.125" -> "12,5%". */
export function percent(rate: string): string {
  const value = Number((Number(rate) * 100).toFixed(2));
  return `${String(value).replace(".", ",")}%`;
}

/** The public register link a partner shares. */
export function shareLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/register?ref=${encodeURIComponent(code)}`;
}

/** Percent as typed ("30", "12,5") to the API's fraction string. */
function parseRatePercent(input: string): Parsed<string> {
  const pct = Number(input.trim().replace(",", "."));
  const max = Number(REFERRAL_RATE_MAX) * 100;
  if (!Number.isFinite(pct) || pct < 0 || pct > max) return { ok: false, problem: `Komisi harus antara 0% dan ${max}%.` };
  return { ok: true, value: String(Number((pct / 100).toFixed(4))) };
}

function parseMonths(input: string): Parsed<number> {
  const months = Number(input.trim());
  if (!Number.isInteger(months) || months < REFERRAL_MONTHS_MIN || months > REFERRAL_MONTHS_MAX)
    return { ok: false, problem: `Masa komisi harus ${REFERRAL_MONTHS_MIN}–${REFERRAL_MONTHS_MAX} bulan.` };
  return { ok: true, value: months };
}

export function rejectProblem(reason: string): string | null {
  return reason.trim().length < 3 ? "Alasan penolakan wajib diisi (minimal 3 karakter)." : null;
}

const reasonProblem = (reason: string) => (reason.trim().length < 3 ? "Alasan wajib diisi (minimal 3 karakter)." : null);

export interface ApproveForm {
  code: string;
  /** Percent as typed. Blank keeps the partner's current rate. */
  ratePercent: string;
  months: string;
}

/** Turns what the admin typed into the request, sending only what they changed. */
export function approveBody(form: ApproveForm): Result<ApproveReferralPartnerInput> {
  const body: ApproveReferralPartnerInput = {};
  if (form.code.trim() !== "") body.code = form.code.trim();
  if (form.ratePercent.trim() !== "") {
    const rate = parseRatePercent(form.ratePercent);
    if (!rate.ok) return rate;
    body.commissionRate = rate.value;
  }
  if (form.months.trim() !== "") {
    const months = parseMonths(form.months);
    if (!months.ok) return months;
    body.commissionMonths = months.value;
  }
  return { ok: true, body };
}

export interface TermsForm {
  ratePercent: string;
  months: string;
  reason: string;
}

/** Per-koperasi commission change: needs a reason and at least one value. */
export function termsChangeBody(form: TermsForm): Result<UpdateTenantReferralInput> {
  const problem = reasonProblem(form.reason);
  if (problem) return { ok: false, problem };
  if (form.ratePercent.trim() === "" && form.months.trim() === "") return { ok: false, problem: "Isi komisi atau masa komisi yang diubah." };
  const body: UpdateTenantReferralInput = { reason: form.reason.trim() };
  if (form.ratePercent.trim() !== "") {
    const rate = parseRatePercent(form.ratePercent);
    if (!rate.ok) return rate;
    body.rate = rate.value;
  }
  if (form.months.trim() !== "") {
    const months = parseMonths(form.months);
    if (!months.ok) return months;
    body.months = months.value;
  }
  return { ok: true, body };
}

/** Program defaults: both values and a reason are required. */
export function settingsBody(form: TermsForm): Result<UpdateReferralSettingsInput> {
  const rate = parseRatePercent(form.ratePercent);
  if (!rate.ok || form.ratePercent.trim() === "") return { ok: false, problem: rate.ok ? "Komisi wajib diisi." : rate.problem };
  const months = parseMonths(form.months);
  if (!months.ok || form.months.trim() === "") return { ok: false, problem: months.ok ? "Masa komisi wajib diisi." : months.problem };
  const problem = reasonProblem(form.reason);
  if (problem) return { ok: false, problem };
  return { ok: true, body: { defaultRate: rate.value, defaultMonths: months.value, reason: form.reason.trim() } };
}

export interface PartnerFormValues {
  name: string;
  email: string;
  phone: string;
  city: string;
  province: string;
  ktpNo: string;
  npwp: string;
  bankName: string;
  bankAccountNo: string;
  bankAccountName: string;
  notes: string;
  code: string;
  ratePercent: string;
  months: string;
}

export const EMPTY_PARTNER_FORM: PartnerFormValues = {
  name: "",
  email: "",
  phone: "",
  city: "",
  province: "",
  ktpNo: "",
  npwp: "",
  bankName: "",
  bankAccountNo: "",
  bankAccountName: "",
  notes: "",
  code: "",
  ratePercent: "",
  months: ""
};

/** Admin-created partner: the public form's field rules, minus terms, plus optional code and commission overrides. */
export function createPartnerBody(form: PartnerFormValues): Result<CreateReferralPartnerInput> {
  const problems = applicationProblems({ ...EMPTY_APPLICATION, ...form, salesPlan: "", acceptTerms: true });
  if (problems.length > 0) return { ok: false, problem: problems[0]! };
  // Terms and honeypot belong to the public form only.
  const built = buildApplication({ ...EMPTY_APPLICATION, ...form, salesPlan: "", acceptTerms: true });
  const publicOnly = new Set(["termsVersion", "acceptTerms", "website"]);
  const fields = Object.fromEntries(Object.entries(built).filter(([key]) => !publicOnly.has(key))) as Omit<
    CreateReferralPartnerInput,
    "code" | "commissionRate" | "commissionMonths" | "notes"
  >;
  const body: CreateReferralPartnerInput = { ...fields };
  if (form.code.trim() !== "") body.code = form.code.trim();
  if (form.notes.trim() !== "") body.notes = form.notes.trim();
  if (form.ratePercent.trim() !== "") {
    const rate = parseRatePercent(form.ratePercent);
    if (!rate.ok) return rate;
    body.commissionRate = rate.value;
  }
  if (form.months.trim() !== "") {
    const months = parseMonths(form.months);
    if (!months.ok) return months;
    body.commissionMonths = months.value;
  }
  return { ok: true, body };
}

export interface PartnerEditForm extends PartnerFormValues {
  status: "ACTIVE" | "SUSPENDED";
  reason: string;
}

/**
 * Edit request. Contact and bank data go through freely; a changed rate, months or status
 * needs a reason, and an unchanged one is not sent, so a pure contact edit never asks for it.
 */
export function partnerEditBody(
  form: PartnerEditForm,
  original: { commissionRate: string; commissionMonths: number; status: "ACTIVE" | "SUSPENDED" | string }
): Result<UpdateReferralPartnerInput> {
  const nullable = (value: string) => (value.trim() === "" ? null : value.trim());
  const body: UpdateReferralPartnerInput = {
    name: form.name.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    city: nullable(form.city),
    province: nullable(form.province),
    npwp: nullable(form.npwp),
    bankName: form.bankName.trim(),
    bankAccountNo: form.bankAccountNo.trim(),
    bankAccountName: form.bankAccountName.trim(),
    notes: nullable(form.notes)
  };
  let sensitive = false;
  if (form.ratePercent.trim() !== "") {
    const rate = parseRatePercent(form.ratePercent);
    if (!rate.ok) return rate;
    if (Number(rate.value) !== Number(original.commissionRate)) {
      body.commissionRate = rate.value;
      sensitive = true;
    }
  }
  if (form.months.trim() !== "") {
    const months = parseMonths(form.months);
    if (!months.ok) return months;
    if (months.value !== original.commissionMonths) {
      body.commissionMonths = months.value;
      sensitive = true;
    }
  }
  if (form.status !== original.status) {
    body.status = form.status;
    sensitive = true;
  }
  if (sensitive) {
    const problem = reasonProblem(form.reason);
    if (problem) return { ok: false, problem };
    body.reason = form.reason.trim();
  }
  return { ok: true, body };
}
