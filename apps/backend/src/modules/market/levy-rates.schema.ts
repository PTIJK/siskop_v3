import { z } from "zod";

const stallKindSchema = z.enum(["KIOS", "LOS", "LAPAK"]);
const chargePeriodSchema = z.enum(["DAILY", "MONTHLY", "YEARLY"]);

export const createLevyRateSchema = z.object({
  marketId: z.string().cuid("Market ID tidak valid"),
  stallKind: stallKindSchema,
  name: z.string().min(1, "Nama tarif wajib diisi"),
  amount: z.coerce.number().positive("Nilai tarif harus lebih dari 0"),
  period: chargePeriodSchema.default("DAILY")
});

export const updateLevyRateSchema = createLevyRateSchema.omit({ marketId: true }).partial().extend({
  isActive: z.boolean().optional()
});

export const listLevyRatesQuerySchema = z.object({
  marketId: z.string().cuid("Market ID tidak valid").optional(),
  stallKind: stallKindSchema.optional(),
  isActive: z.coerce.boolean().optional()
});

export type CreateLevyRateInput = z.infer<typeof createLevyRateSchema>;
export type UpdateLevyRateInput = z.infer<typeof updateLevyRateSchema>;
export type ListLevyRatesQueryInput = z.infer<typeof listLevyRatesQuerySchema>;
