import { Prisma } from "@prisma/client";
import { z } from "zod";

// Mirrors a Decimal(15,2) column: ≤13 integer digits, ≤2 decimal places, so an
// out-of-range value is a 422 at the schema rather than a Postgres overflow 500.
const MONEY_PATTERN = /^\d{1,13}(\.\d{1,2})?$/;

/**
 * A money field parsed straight into `Prisma.Decimal` (CLAUDE.md rule 2).
 * Accepts a decimal string or a JSON number for backward compatibility; a
 * number is stringified first, so a float artefact like 0.30000000000000004
 * fails the 2-decimal pattern instead of being silently rounded.
 */
export function moneySchema(label: string, opts: { positive?: boolean } = {}) {
  return z
    .union([z.string().trim(), z.number().finite()])
    .transform((v) => String(v))
    .refine((v) => MONEY_PATTERN.test(v), `${label} harus berupa angka non-negatif (maks. 13 digit, 2 desimal)`)
    .transform((v) => new Prisma.Decimal(v))
    .refine((v) => !opts.positive || v.gt(0), `${label} harus lebih dari 0`);
}
