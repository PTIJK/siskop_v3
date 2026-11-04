import { z } from "zod";
import { REFERRAL_MONTHS_MAX, REFERRAL_MONTHS_MIN, REFERRAL_RATE_MAX } from "@siskop/types";

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** 08… / 628… / +628…, with spaces and dashes tolerated; stored as 08…. */
export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s.-]/g, ""))
  .refine((v) => /^(?:\+62|62|0)8\d{8,12}$/.test(v), "Nomor WhatsApp tidak valid")
  .transform((v) => v.replace(/^(?:\+62|62)/, "0"));

/**
 * Public, so strict: unknown fields are rejected and `website` is a honeypot
 * that real users never see. Commission terms are never client-supplied.
 */
export const partnerApplicationSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    email: z.string().trim().toLowerCase().email().max(254),
    phone: phoneSchema,
    city: optionalText(100),
    province: optionalText(100),
    ktpNo: z.string().trim().regex(/^\d{16}$/, "NIK harus 16 digit"),
    npwp: optionalText(25),
    bankName: text(100),
    bankAccountNo: z.string().trim().regex(/^\d{5,25}$/, "Nomor rekening tidak valid"),
    bankAccountName: text(100),
    salesPlan: optionalText(1000),
    termsVersion: text(30),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: "Syarat mitra harus disetujui" }) }),
    website: z.string().max(0).optional()
  })
  .strict();

const rate = z
  .string()
  .regex(/^\d(\.\d{1,4})?$/, "Komisi tidak valid")
  .refine((v) => Number(v) >= 0 && Number(v) <= Number(REFERRAL_RATE_MAX), `Komisi harus antara 0% dan ${Number(REFERRAL_RATE_MAX) * 100}%`);
const months = z.number().int().min(REFERRAL_MONTHS_MIN).max(REFERRAL_MONTHS_MAX);

export const approvePartnerSchema = z
  .object({
    code: z.string().trim().max(20).optional(),
    commissionRate: rate.optional(),
    commissionMonths: months.optional()
  })
  .strict();

export const rejectPartnerSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();

export const partnerListQuerySchema = z.object({ status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"]).optional() });
