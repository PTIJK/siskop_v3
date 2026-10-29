import { z } from "zod";

/**
 * Strict on purpose: the quote endpoint takes a selection, never a price. A
 * client that sends `amountPerCycle`, `price` or anything else is rejected
 * rather than silently ignored.
 */
export const quoteRequestSchema = z
  .object({
    packageCode: z.string().min(1).max(50),
    billingCycle: z.enum(["MONTHLY", "YEARLY"]),
    supportPlanCode: z.string().min(1).max(50).optional(),
    featureKeys: z.array(z.string().min(1).max(100)).max(100).optional(),
    addons: z
      .array(z.object({ itemKey: z.enum(["MEMBERS", "USERS", "SAVING_TYPES", "LOAN_TYPES"]), qty: z.number().int().min(1).max(1_000_000) }).strict())
      .max(4)
      .optional()
  })
  .strict();
