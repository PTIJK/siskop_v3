import { z } from "zod";
import { CooperativeType } from "@siskop/types";
import { slugSchema } from "../tenants/provision.js";
import { quoteRequestSchema } from "../pricing/schema.js";

import { cooperativeNikSchema } from "./ods.js";

const RESERVED = new Set(["www", "api", "admin", "app", "static", "cdn", "localhost"]);

/**
 * Registration carries a package selection and nothing priced. quoteRequestSchema
 * is strict, so a client-supplied amount is rejected rather than ignored, and so
 * is any stray top-level price field.
 */
export const registrationSchema = z
  .object({
    subscription: quoteRequestSchema,
    tenantName: z.string().trim().min(2, "Nama koperasi minimal 2 karakter").max(150, "Nama koperasi maksimal 150 karakter"),
    // Accept older clients while the current form generates this value server-side.
    slug: slugSchema.refine((value) => !RESERVED.has(value), "Alamat workspace ini tidak tersedia").optional(),
    registrationNo: z.string().trim().min(1, "Nomor badan hukum wajib diisi").max(100, "Nomor badan hukum maksimal 100 karakter"),
    cooperativeNik: cooperativeNikSchema.optional(),
    address: z.string().trim().min(5, "Alamat koperasi minimal 5 karakter").max(500, "Alamat koperasi maksimal 500 karakter"),
    type: z.enum(["SYARIAH", "KONVENSIONAL"]),
    adminName: z.string().trim().min(2, "Nama pengurus minimal 2 karakter").max(100, "Nama pengurus maksimal 100 karakter"),
    idToken: z.string().min(1, "Sesi verifikasi akun tidak valid. Silakan ulangi.").max(10000),
    firstUnit: z.object({ type: z.nativeEnum(CooperativeType), name: z.string().trim().min(1, "Nama unit wajib diisi").max(100) }).optional(),
    // Blank means "no code"; a code that does not resolve is rejected in the service.
    referralCode: z.string().trim().max(30, "Kode referral maksimal 30 karakter").optional()
  })
  .strict();

export const firebaseSignInSchema = z.object({ idToken: z.string().min(1).max(10000) });
