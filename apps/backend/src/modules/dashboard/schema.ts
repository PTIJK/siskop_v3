import { z } from "zod";

export const chartQuerySchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6)
});

export type ChartQueryInput = z.infer<typeof chartQuerySchema>;

export const dashboardUnitQuerySchema = z.object({
  unitId: z.string().cuid("Unit ID tidak valid").optional()
});
