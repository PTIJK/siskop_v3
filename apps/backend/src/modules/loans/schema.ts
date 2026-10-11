import { z } from "zod";
import { moneySchema } from "../../lib/money.js";

export const createLoanConfigSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  type: z.enum(["SYARIAH", "KONVENSIONAL"]),
  rateType: z.enum(["BUNGA", "BAGI_HASIL", "MARGIN", "HARIAN"]),
  rate: z.coerce.number().min(0).max(100),
  maxTermMonths: z.coerce.number().int().min(1).max(360),
  // Koperasi pasar plan F2 — DAILY/WEEKLY frequencies replace maxTermMonths
  // with maxInstallments as the tenor cap (see modules/loans/service.ts).
  installmentFrequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]).default("MONTHLY"),
  maxInstallments: z.coerce.number().int().min(1).optional()
});

export const updateLoanConfigSchema = createLoanConfigSchema.partial();

export const createLoanSchema = z.object({
  memberId: z.string().cuid("Member ID tidak valid"),
  loanConfigId: z.string().cuid("Loan config ID tidak valid"),
  principalAmount: moneySchema("Nominal pinjaman", { positive: true }),
  // Required for a MONTHLY loan config; ignored for DAILY/WEEKLY, which use installmentCount.
  termMonths: z.coerce.number().int().min(1).optional(),
  // Required for a DAILY/WEEKLY loan config.
  installmentCount: z.coerce.number().int().min(1).optional(),
  // Employee override of the product's rate (D3) — requires rateNote, capped at 24%/year.
  rate: z.coerce.number().min(0).max(100).optional(),
  rateNote: z.string().min(1).optional(),
  force: z.boolean().default(false),
  acknowledgeBmpp: z.boolean().default(false),
  disbursedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD")
    .optional(),
  // Optional KSU override: when omitted, createLoan falls back to the
  // tenant's default unit exactly as before (see lib/units.ts#resolveUnitId).
  unitId: z.string().cuid("Unit ID tidak valid").optional()
});

export const loanPaymentSchema = z.object({
  amount: moneySchema("Nominal bayar", { positive: true }),
  penalty: moneySchema("Denda").default(0),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD"),
  note: z.string().optional()
});

export const previewScheduleSchema = z.object({
  loanConfigId: z.string().cuid("Loan config ID tidak valid"),
  principalAmount: moneySchema("Nominal pinjaman", { positive: true }),
  termMonths: z.coerce.number().int().min(1).optional(),
  installmentCount: z.coerce.number().int().min(1).optional(),
  rate: z.coerce.number().min(0).max(100).optional(),
  disbursedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD")
    .optional()
});

export const listLoansQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.enum(["PENDING", "ACTIVE", "COMPLETED", "DEFAULTED"]).optional(),
  kolCategory: z.enum(["LANCAR", "DALAM_PERHATIAN", "KURANG_LANCAR", "DIRAGUKAN", "MACET"]).optional(),
  memberId: z.string().optional(),
  loanConfigId: z.string().optional()
});

export type CreateLoanConfigInput = z.infer<typeof createLoanConfigSchema>;
export type UpdateLoanConfigInput = z.infer<typeof updateLoanConfigSchema>;
export const bmppHeadroomQuerySchema = z.object({
  memberId: z.string().cuid("Member ID tidak valid"),
  unitId: z.string().cuid("Unit ID tidak valid").optional()
});

export type CreateLoanInput = z.infer<typeof createLoanSchema>;
export type BmppHeadroomQueryInput = z.infer<typeof bmppHeadroomQuerySchema>;
export type LoanPaymentInput = z.infer<typeof loanPaymentSchema>;
export type ListLoansQueryInput = z.infer<typeof listLoansQuerySchema>;
export type PreviewScheduleInput = z.infer<typeof previewScheduleSchema>;
