import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD");

export const salesReportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  // Omitted = every unit the caller may access, combined (CLAUDE.md rule 2b).
  unitId: z.string().cuid("Unit ID tidak valid").optional()
});

export type SalesReportQueryInput = z.infer<typeof salesReportQuerySchema>;
