import { z } from "zod";

export const financialParamsSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional()
});

export const ratParamsSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).default(new Date().getFullYear())
});

// Omitted = the consolidated report (CLAUDE.md rule 2b). SHU distribution and CALK take no
// unit: they are cooperative-level statements, not something a single unit files.
const unitIdParam = z.string().cuid("Unit ID tidak valid").optional();

// Optional comparative column: the same statement for the earlier period/date (lib/comparison.ts).
const compareParam = z.enum(["PREVIOUS_PERIOD", "PREVIOUS_YEAR"]).optional();

export const neracaParamsSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional(),
  unitId: unitIdParam,
  compare: compareParam
});

export const periodParamsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional()
});

export const unitPeriodParamsSchema = periodParamsSchema.extend({ unitId: unitIdParam });

export const comparablePeriodParamsSchema = unitPeriodParamsSchema.extend({ compare: compareParam });

export const upsertCalkNarrativeSchema = z.object({
  section: z.enum(["UMUM", "DASAR_PENYUSUNAN", "KEBIJAKAN_AKUNTANSI", "INFORMASI_TAMBAHAN"]),
  content: z.string().max(20000)
});

// ── Koperasi pasar plan F7 — Laporan ──────────────────────────────────────────

export const rekapHarianKolektorParamsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional()
});

export const tunggakanAngsuranParamsSchema = z.object({
  collectorId: z.string().cuid("Collector ID tidak valid").optional(),
  marketId: z.string().cuid("Market ID tidak valid").optional(),
  block: z.string().optional()
});

export const tunggakanSewaRetribusiParamsSchema = z.object({
  marketId: z.string().cuid("Market ID tidak valid").optional(),
  block: z.string().optional(),
  memberId: z.string().cuid("Member ID tidak valid").optional()
});

export type FinancialParamsInput = z.infer<typeof financialParamsSchema>;
export type RatParamsInput = z.infer<typeof ratParamsSchema>;
export type NeracaParamsInput = z.infer<typeof neracaParamsSchema>;
export type PeriodParamsInput = z.infer<typeof periodParamsSchema>;
export type UnitPeriodParamsInput = z.infer<typeof unitPeriodParamsSchema>;
export type UpsertCalkNarrativeInput = z.infer<typeof upsertCalkNarrativeSchema>;
export type RekapHarianKolektorParamsInput = z.infer<typeof rekapHarianKolektorParamsSchema>;
export type TunggakanAngsuranParamsInput = z.infer<typeof tunggakanAngsuranParamsSchema>;
export type TunggakanSewaRetribusiParamsInput = z.infer<typeof tunggakanSewaRetribusiParamsSchema>;

// ── Accounting books (Jurnal Umum, Neraca Saldo, Buku Besar) ──────────────────

const bookUnitParam = z.union([z.literal("unallocated"), z.string().cuid("Unit ID tidak valid")]).optional();

const bookPagingParams = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50)
};

export const jurnalParamsSchema = periodParamsSchema.extend({
  unitId: bookUnitParam,
  type: z.enum(["UMUM", "PENYESUAIAN", "PENUTUP"]).optional(),
  sourceType: z
    .enum([
      "SAVING_TRANSACTION",
      "LOAN_PAYMENT",
      "LOAN_DISBURSEMENT",
      "POS_SALE",
      "MEMBER_CREDIT_REPAYMENT",
      "MANUAL",
      "MANUAL_EXPENSE",
      "STOCK_MOVEMENT",
      "COLLECTION_BATCH",
      "CHARGE_ACCRUAL",
      "CHARGE_PAYMENT"
    ])
    .optional(),
  ...bookPagingParams
});

export const trialBalanceParamsSchema = periodParamsSchema.extend({ unitId: bookUnitParam, compare: compareParam });

export const bukuBesarAccountParamsSchema = periodParamsSchema.extend({ unitId: bookUnitParam, ...bookPagingParams });

export type JurnalParamsInput = z.infer<typeof jurnalParamsSchema>;
export type TrialBalanceParamsInput = z.infer<typeof trialBalanceParamsSchema>;
export type BukuBesarAccountParamsInput = z.infer<typeof bukuBesarAccountParamsSchema>;

// ── Export (CSV / XLSX) ───────────────────────────────────────────────────────

export const exportParamsSchema = periodParamsSchema.extend({
  format: z.enum(["csv", "xlsx"], { errorMap: () => ({ message: "Format ekspor: csv atau xlsx" }) }),
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD").optional(),
  unitId: bookUnitParam,
  /** Buku Besar for one account instead of the overview. */
  accountId: z.string().min(1).optional()
});
