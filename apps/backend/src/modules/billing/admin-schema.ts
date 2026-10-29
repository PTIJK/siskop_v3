import { z } from "zod";

const DAY_MS = 86_400_000;

export const invoiceListQuerySchema = z
  .object({
    status: z.enum(["OPEN", "PAID", "EXPIRED", "VOID"]).optional(),
    tenantId: z.string().min(1).max(64).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25)
  })
  .strict();
export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

/** Deliberately no amount: a payment always settles the invoice's own total. */
export const markPaidSchema = z
  .object({
    method: z.enum(["BANK_TRANSFER", "CASH", "OTHER"]).default("BANK_TRANSFER"),
    reference: z.string().trim().min(1).max(100).optional(),
    paidAt: z
      .string()
      .datetime()
      .transform((v) => new Date(v))
      // A day of slack for clock drift between the owner's browser and the server.
      .refine((d) => d.getTime() <= Date.now() + DAY_MS, "Payment date cannot be in the future")
      .optional()
  })
  .strict();
export type MarkPaidInput = z.infer<typeof markPaidSchema>;
