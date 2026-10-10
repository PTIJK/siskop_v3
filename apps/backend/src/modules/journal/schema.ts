import { z } from "zod";
import { Prisma } from "@prisma/client";

/** A positive amount with at most 2 decimals, accepted as number or numeric string. */
const amountSchema = z
  .union([z.number(), z.string().trim().min(1)])
  .refine((v) => {
    try {
      const d = new Prisma.Decimal(v);
      return d.isFinite() && d.gte(0) && d.decimalPlaces() <= 2;
    } catch {
      return false;
    }
  }, "Jumlah harus berupa angka positif dengan maksimal 2 desimal")
  .optional();

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD");

export const createManualJournalSchema = z.object({
  entryDate: dateSchema,
  description: z.string().trim().min(1, "Keterangan wajib diisi").max(500),
  entryType: z.enum(["UMUM", "PENYESUAIAN"]),
  unitId: z.string().min(1).nullable().optional(),
  lines: z
    .array(z.object({ accountId: z.string().min(1, "Pilih akun"), debit: amountSchema, credit: amountSchema }))
    .min(2, "Jurnal minimal terdiri dari 2 baris")
    .max(200)
});

export const reverseManualJournalSchema = z.object({
  entryDate: dateSchema.optional()
});

export type CreateManualJournalInput = z.infer<typeof createManualJournalSchema>;
export type ReverseManualJournalInput = z.infer<typeof reverseManualJournalSchema>;
