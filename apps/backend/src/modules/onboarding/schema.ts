import { z } from "zod";
import { CooperativeType } from "@siskop/types";
import { slugSchema } from "../tenants/provision.js";

export const paymentSessionWebhookDataSchema = z
  .object({
    reference_id: z.string().min(1),
    payment_session_id: z.string().min(1).optional(),
    // Dashboard test deliveries use `id`; session API responses use `payment_session_id`.
    id: z.string().min(1).optional()
  })
  .refine((data) => !!(data.payment_session_id ?? data.id), "Payment session ID is required")
  .refine(
    (data) => !data.payment_session_id || !data.id || data.payment_session_id === data.id,
    "Conflicting payment session IDs"
  )
  .transform((data) => ({
    referenceId: data.reference_id,
    sessionId: (data.payment_session_id ?? data.id)!
  }));

const RESERVED = new Set(["www", "api", "admin", "app", "static", "cdn", "localhost"]);
export const registrationSchema = z.object({
  packageId: z.string().min(1).max(100),
  tenantName: z.string().trim().min(2).max(150),
  slug: slugSchema.refine((value) => !RESERVED.has(value), "Alamat workspace ini tidak tersedia"),
  registrationNo: z.string().trim().min(1).max(100),
  address: z.string().trim().min(5).max(500),
  type: z.enum(["SYARIAH", "KONVENSIONAL"]),
  adminName: z.string().trim().min(2).max(100),
  idToken: z.string().min(1).max(10000),
  firstUnit: z.object({ type: z.nativeEnum(CooperativeType), name: z.string().trim().min(1).max(100) })
});
export const resumeSchema = z.object({
  slug: slugSchema,
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72)
});
export const firebaseSignInSchema = z.object({ idToken: z.string().min(1).max(10000) });
