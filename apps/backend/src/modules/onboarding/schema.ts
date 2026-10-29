import { z } from "zod";
import { CooperativeType } from "@siskop/types";
import { slugSchema } from "../tenants/provision.js";
import { quoteRequestSchema } from "../pricing/schema.js";

const RESERVED = new Set(["www", "api", "admin", "app", "static", "cdn", "localhost"]);

/**
 * Registration carries a package selection and nothing priced. quoteRequestSchema
 * is strict, so a client-supplied amount is rejected rather than ignored, and so
 * is any stray top-level price field.
 */
export const registrationSchema = z
  .object({
    subscription: quoteRequestSchema,
    tenantName: z.string().trim().min(2).max(150),
    // Accept older clients while the current form generates this value server-side.
    slug: slugSchema.refine((value) => !RESERVED.has(value), "Alamat workspace ini tidak tersedia").optional(),
    registrationNo: z.string().trim().min(1).max(100),
    address: z.string().trim().min(5).max(500),
    type: z.enum(["SYARIAH", "KONVENSIONAL"]),
    adminName: z.string().trim().min(2).max(100),
    idToken: z.string().min(1).max(10000),
    firstUnit: z.object({ type: z.nativeEnum(CooperativeType), name: z.string().trim().min(1).max(100) }).optional()
  })
  .strict();

export const firebaseSignInSchema = z.object({ idToken: z.string().min(1).max(10000) });
