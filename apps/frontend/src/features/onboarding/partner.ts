import type { ReferralPartnerApplicationInput } from "@siskop/types";

/** Bump when the partner terms text changes; the server stores the version the applicant accepted. */
export const PARTNER_TERMS_VERSION = "2026-11";

export interface PartnerApplicationForm {
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
  salesPlan: string;
  acceptTerms: boolean;
  /** Honeypot: hidden from people, filled by bots. Never sent unless filled. */
  website: string;
}

export const EMPTY_APPLICATION: PartnerApplicationForm = {
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
  salesPlan: "",
  acceptTerms: false,
  website: ""
};

/** What is wrong with the form, in the applicant's words. The server checks the same rules. */
export function applicationProblems(form: PartnerApplicationForm): string[] {
  const problems: string[] = [];
  if (form.name.trim().length < 2) problems.push("Nama lengkap wajib diisi (minimal 2 karakter).");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) problems.push("Email tidak valid.");
  if (!/^(?:\+62|62|0)8\d{8,12}$/.test(form.phone.replace(/[\s.-]/g, ""))) problems.push("Nomor WhatsApp tidak valid.");
  if (!/^\d{16}$/.test(form.ktpNo.trim())) problems.push("NIK harus 16 digit angka.");
  if (form.bankName.trim() === "") problems.push("Nama bank wajib diisi.");
  if (!/^\d{5,25}$/.test(form.bankAccountNo.trim())) problems.push("Nomor rekening hanya berisi angka (5–25 digit).");
  if (form.bankAccountName.trim() === "") problems.push("Nama pemilik rekening wajib diisi.");
  if (!form.acceptTerms) problems.push("Syarat mitra harus disetujui.");
  return problems;
}

/** The request body. Commission terms are set by the platform, never by the applicant. */
export function buildApplication(form: PartnerApplicationForm): ReferralPartnerApplicationInput & { website?: string } {
  const pick = <K extends string>(key: K, value: string) => (value.trim() === "" ? {} : ({ [key]: value.trim() } as Record<K, string>));
  return {
    name: form.name.trim(),
    email: form.email.trim(),
    phone: form.phone.trim(),
    ...pick("city", form.city),
    ...pick("province", form.province),
    ktpNo: form.ktpNo.trim(),
    ...pick("npwp", form.npwp),
    bankName: form.bankName.trim(),
    bankAccountNo: form.bankAccountNo.trim(),
    bankAccountName: form.bankAccountName.trim(),
    ...pick("salesPlan", form.salesPlan),
    termsVersion: PARTNER_TERMS_VERSION,
    acceptTerms: true,
    ...(form.website !== "" ? { website: form.website } : {})
  };
}
