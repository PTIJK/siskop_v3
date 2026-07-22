import { z } from 'zod';

export const UpsertShuDistributionSchema = z.object({
  jasaSimpananPercent: z.coerce.number().min(0).max(100),
  jasaPinjamanPercent: z.coerce.number().min(0).max(100),
  cadanganPercent: z.coerce.number().min(0).max(100),
  lainnyaPercent: z.coerce.number().min(0).max(100),
});

export type UpsertShuDistributionInput = z.infer<typeof UpsertShuDistributionSchema>;
