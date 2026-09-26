import { z } from "zod";

export const createMarketSchema = z.object({
  name: z.string().min(2, "Nama pasar minimal 2 karakter"),
  address: z.string().min(1).optional()
});

export const updateMarketSchema = createMarketSchema.partial().extend({
  isActive: z.boolean().optional()
});

const stallKindSchema = z.enum(["KIOS", "LOS", "LAPAK"]);
const stallStatusSchema = z.enum(["AVAILABLE", "OCCUPIED", "INACTIVE"]);

export const createStallSchema = z.object({
  marketId: z.string().cuid("Market ID tidak valid"),
  code: z.string().min(1, "Kode kios wajib diisi"),
  block: z.string().min(1).optional(),
  kind: stallKindSchema,
  areaM2: z.coerce.number().positive().optional()
});

export const updateStallSchema = createStallSchema.omit({ marketId: true }).partial().extend({
  status: stallStatusSchema.optional()
});

export const listStallsQuerySchema = z.object({
  marketId: z.string().cuid("Market ID tidak valid").optional(),
  block: z.string().optional(),
  status: stallStatusSchema.optional()
});

export type CreateMarketInput = z.infer<typeof createMarketSchema>;
export type UpdateMarketInput = z.infer<typeof updateMarketSchema>;
export type CreateStallInput = z.infer<typeof createStallSchema>;
export type UpdateStallInput = z.infer<typeof updateStallSchema>;
export type ListStallsQueryInput = z.infer<typeof listStallsQuerySchema>;
