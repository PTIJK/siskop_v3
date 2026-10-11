import { z } from "zod";
import { differenceInCalendarDays, format, parseISO, startOfMonth } from "date-fns";

export const createSavingConfigSchema = z.object({
  name: z.string().min(2, "Nama minimal 2 karakter"),
  type: z.enum(["POKOK", "WAJIB", "SUKARELA"]),
  rateType: z.enum(["BUNGA", "BAGI_HASIL", "MARGIN"]),
  rate: z.coerce.number().min(0).max(100),
  periodUnit: z.enum(["DAILY", "MONTHLY", "YEARLY"])
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

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal: YYYY-MM-DD");
const MAX_STATEMENT_DAYS = 366;

function toYmd(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Rekening Koran period — inclusive `YYYY-MM-DD` dates in server-local time,
 * defaulting to the current month to date. Capped at a year so an account with
 * daily interest can't be asked for an unbounded ledger in one response. */
export const savingStatementQuerySchema = z
  .object({ from: ymd.optional(), to: ymd.optional() })
  .transform(({ from, to }) => {
    const today = new Date();
    return { from: from ?? toYmd(startOfMonth(today)), to: to ?? toYmd(today) };
  })
  .refine(({ from, to }) => from <= to, { message: "Tanggal awal harus sebelum tanggal akhir", path: ["from"] })
  .refine(({ from, to }) => differenceInCalendarDays(parseISO(to), parseISO(from)) < MAX_STATEMENT_DAYS, {
    message: `Periode maksimal ${MAX_STATEMENT_DAYS} hari`,
    path: ["to"]
  });

export type CreateSavingConfigInput = z.infer<typeof createSavingConfigSchema>;
export type UpdateSavingConfigInput = z.infer<typeof updateSavingConfigSchema>;
export type CreateSavingInput = z.infer<typeof createSavingSchema>;
export type SavingTransactionInput = z.infer<typeof savingTransactionSchema>;
export type ListSavingsQueryInput = z.infer<typeof listSavingsQuerySchema>;
export type ListSavingTransactionsQueryInput = z.infer<typeof listSavingTransactionsQuerySchema>;
export type SavingStatementQueryInput = z.infer<typeof savingStatementQuerySchema>;
