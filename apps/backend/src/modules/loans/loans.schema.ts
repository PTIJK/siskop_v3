import { z } from 'zod';
import { LoanType, RateType, LoanStatus, KOLCategory } from '@siskop/shared';

export const CreateLoanConfigSchema = z.object({
  name: z.string().min(2, 'Nama minimal 2 karakter'),
  type: z.nativeEnum(LoanType),
  rateType: z.nativeEnum(RateType),
  rate: z.coerce.number().min(0).max(100),
  maxTermMonths: z.coerce.number().int().min(1).max(360),
});

export const UpdateLoanConfigSchema = CreateLoanConfigSchema.partial();

export const CreateLoanSchema = z.object({
  memberId: z.string().cuid('Member ID tidak valid'),
  loanConfigId: z.string().cuid('Loan config ID tidak valid'),
  principalAmount: z.coerce.number().positive('Nominal pinjaman harus lebih dari 0'),
  termMonths: z.coerce.number().int().min(1),
  force: z.boolean().default(false),
  disbursedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal: YYYY-MM-DD')
    .optional(),
});

export const LoanPaymentSchema = z.object({
  amount: z.coerce.number().positive('Nominal bayar harus lebih dari 0'),
  penalty: z.coerce.number().min(0).default(0),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal: YYYY-MM-DD'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal: YYYY-MM-DD'),
  note: z.string().optional(),
});

export const LoanQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  status: z.nativeEnum(LoanStatus).optional(),
  kolCategory: z.nativeEnum(KOLCategory).optional(),
  memberId: z.string().optional(),
});

export type CreateLoanConfigInput = z.infer<typeof CreateLoanConfigSchema>;
export type UpdateLoanConfigInput = z.infer<typeof UpdateLoanConfigSchema>;
export type CreateLoanInput = z.infer<typeof CreateLoanSchema>;
export type LoanPaymentInput = z.infer<typeof LoanPaymentSchema>;
export type LoanQuery = z.infer<typeof LoanQuerySchema>;
