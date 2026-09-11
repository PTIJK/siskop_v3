import { z } from "zod";

export const searchCreditMembersQuerySchema = z.object({
  search: z.string().min(1, "Kata kunci pencarian wajib diisi")
});

export const recordCreditRepaymentSchema = z.object({
  memberId: z.string().cuid("Member ID tidak valid"),
  amount: z.coerce.number().positive("Jumlah harus lebih dari 0"),
  note: z.string().optional()
});

export type SearchCreditMembersQueryInput = z.infer<typeof searchCreditMembersQuerySchema>;
export type RecordCreditRepaymentInput = z.infer<typeof recordCreditRepaymentSchema>;
