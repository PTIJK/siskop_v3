import { z } from "zod";

const installmentStatusSchema = z.enum(["UNPAID", "PARTIAL", "PAID"]);

// A blank optional text input submits "" (react-hook-form's uncontrolled
// register), not an absent field — same issue schema.ts's optionalText() guards.
const optionalText = () =>
  z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v));

export const listChargesQuerySchema = z.object({
  marketId: z.string().cuid("Market ID tidak valid").optional(),
  block: z.string().optional(),
  status: installmentStatusSchema.optional(),
  memberId: z.string().cuid("Anggota ID tidak valid").optional()
});

export const payChargeSchema = z.object({
  amount: z.coerce.number().positive("Nominal bayar harus lebih dari 0"),
  note: optionalText()
});

export type ListChargesQueryInput = z.infer<typeof listChargesQuerySchema>;
export type PayChargeInput = z.infer<typeof payChargeSchema>;
