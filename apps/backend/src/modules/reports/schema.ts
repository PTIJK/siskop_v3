import { z } from "zod";

export const financialParamsSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional()
});

export const ratParamsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear())
});

export const neracaParamsSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional()
});

export const periodParamsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional()
});

export const upsertCalkNarrativeSchema = z.object({
  section: z.enum(["UMUM", "DASAR_PENYUSUNAN", "KEBIJAKAN_AKUNTANSI", "INFORMASI_TAMBAHAN"]),
  content: z.string().max(20000)
});

export type FinancialParamsInput = z.infer<typeof financialParamsSchema>;
export type RatParamsInput = z.infer<typeof ratParamsSchema>;
export type NeracaParamsInput = z.infer<typeof neracaParamsSchema>;
export type PeriodParamsInput = z.infer<typeof periodParamsSchema>;
export type UpsertCalkNarrativeInput = z.infer<typeof upsertCalkNarrativeSchema>;
