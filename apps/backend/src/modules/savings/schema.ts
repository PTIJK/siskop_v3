import { z } from "zod";

export const createSavingConfigSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  type: z.enum(["POKOK", "WAJIB", "SUKARELA"]),
  rateType: z.enum(["BUNGA", "BAGI_HASIL", "MARGIN"]),
  rate: z.coerce.number().min(0).max(100),
  periodUnit: z.enum(["MONTHLY", "YEARLY"])
});

export const updateSavingConfigSchema = createSavingConfigSchema.partial();

export const createSavingSchema = z.object({
  memberId: z.string().cuid("Member ID tidak valid"),
  savingConfigId: z.string().cuid("Saving config ID tidak valid"),
  initialDeposit: z.coerce.number().min(0).default(0)
});

export const savingTransactionSchema = z.object({
  amount: z.coerce.number().positive("Nominal harus lebih dari 0"),
  note: z.string().optional()
});

export const listSavingsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  memberId: z.string().optional(),
  type: z.enum(["POKOK", "WAJIB", "SUKARELA"]).optional()
});

export const listSavingTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20)
});

export type CreateSavingConfigInput = z.infer<typeof createSavingConfigSchema>;
export type UpdateSavingConfigInput = z.infer<typeof updateSavingConfigSchema>;
export type CreateSavingInput = z.infer<typeof createSavingSchema>;
export type SavingTransactionInput = z.infer<typeof savingTransactionSchema>;
export type ListSavingsQueryInput = z.infer<typeof listSavingsQuerySchema>;
export type ListSavingTransactionsQueryInput = z.infer<typeof listSavingTransactionsQuerySchema>;
