import { z } from "zod";

export const createLoanConfigSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  type: z.enum(["SYARIAH", "KONVENSIONAL"]),
  rateType: z.enum(["BUNGA", "BAGI_HASIL", "MARGIN"]),
  rate: z.coerce.number().min(0).max(100),
  maxTermMonths: z.coerce.number().int().min(1).max(360)
});

export const updateLoanConfigSchema = createLoanConfigSchema.partial();

export const createLoanSchema = z.object({
  memberId: z.string().cuid("Member ID tidak valid"),
  loanConfigId: z.string().cuid("Loan config ID tidak valid"),
  principalAmount: z.coerce.number().positive("Nominal pinjaman harus lebih dari 0"),
  termMonths: z.coerce.number().int().min(1),
  force: z.boolean().default(false),
  disbursedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD")
    .optional()
});

export const loanPaymentSchema = z.object({
  amount: z.coerce.number().positive("Nominal bayar harus lebih dari 0"),
  penalty: z.coerce.number().min(0).default(0),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD"),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD"),
  note: z.string().optional()
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
export type CreateLoanInput = z.infer<typeof createLoanSchema>;
export type LoanPaymentInput = z.infer<typeof loanPaymentSchema>;
export type ListLoansQueryInput = z.infer<typeof listLoansQuerySchema>;
