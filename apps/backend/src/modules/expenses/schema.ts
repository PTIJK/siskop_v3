import { z } from "zod";

export const createExpenseSchema = z.object({
  entryDate: z.coerce.date(),
  description: z.string().min(1, "Keterangan wajib diisi"),
  amount: z.coerce.number().positive("Jumlah harus lebih dari 0"),
  debitAccountId: z.string().min(1, "Pilih akun beban"),
  creditAccountId: z.string().min(1, "Pilih akun kas/bank"),
  unitId: z.string().optional()
});

export const listExpensesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unitId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional()
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type ListExpensesQueryInput = z.infer<typeof listExpensesQuerySchema>;
