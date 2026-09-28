import { z } from "zod";

// A blank optional text input submits "" (react-hook-form's uncontrolled
// register), not an absent field — treat that the same as "not provided"
// instead of failing a `.min(1)` that would only ever reject the empty form
// default, never a real "cleared" intent.
const optionalText = () =>
  z
    .string()
    .optional()
    .transform((v) => (v === "" ? undefined : v));

// Same issue as optionalText above, but z.coerce.number() coerces "" to 0
// *before* `.optional()` ever sees it — an empty area field would fail
// `.positive()` instead of being treated as "not provided". Strip "" (and
// null, which JSON.stringify(undefined) never produces but a client could
// still send) to undefined first, so coercion only ever runs on a real value.
const optionalPositiveNumber = () =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), z.coerce.number().positive().optional());

export const createMarketSchema = z.object({
  name: z.string().min(2, "Nama pasar minimal 2 karakter"),
  address: optionalText()
});

export const updateMarketSchema = createMarketSchema.partial().extend({
  isActive: z.boolean().optional()
});

const stallKindSchema = z.enum(["KIOS", "LOS", "LAPAK"]);
const stallStatusSchema = z.enum(["AVAILABLE", "OCCUPIED", "INACTIVE"]);

export const createStallSchema = z.object({
  marketId: z.string().cuid("Market ID tidak valid"),
  code: z.string().min(1, "Kode kios wajib diisi"),
  block: optionalText(),
  kind: stallKindSchema,
  areaM2: optionalPositiveNumber()
});

export const updateStallSchema = createStallSchema.omit({ marketId: true }).partial().extend({
  status: stallStatusSchema.optional()
});

export const listStallsQuerySchema = z.object({
  marketId: z.string().cuid("Market ID tidak valid").optional(),
  block: z.string().optional(),
  status: stallStatusSchema.optional()
});

export type CreateMarketInput = z.infer<typeof createMarketSchema>;
export type UpdateMarketInput = z.infer<typeof updateMarketSchema>;
export type CreateStallInput = z.infer<typeof createStallSchema>;
export type UpdateStallInput = z.infer<typeof updateStallSchema>;
export type ListStallsQueryInput = z.infer<typeof listStallsQuerySchema>;
