import { z } from "zod";

export const searchCreditMembersQuerySchema = z.object({
  search: z.string().min(1, "Kata kunci pencarian wajib diisi")
});

export const recordCreditRepaymentSchema = z.object({
  memberId: z.string().cuid("Member ID tidak valid"),
  amount: z.coerce.number().positive("Jumlah harus lebih dari 0"),
  note: z.string().optional()
});

/** Mirrors loans/schema.ts#listLoansQuerySchema's page/limit/search shape. */
export const listOutstandingCreditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional()
});

export type SearchCreditMembersQueryInput = z.infer<typeof searchCreditMembersQuerySchema>;
export type RecordCreditRepaymentInput = z.infer<typeof recordCreditRepaymentSchema>;
export type ListOutstandingCreditQueryInput = z.infer<typeof listOutstandingCreditQuerySchema>;
