import { z } from "zod";
import { memberFieldsSchema } from "./schema.js";

// Same field rules as the internal createMemberSchema (memberFieldsSchema),
// extended with the two things only the public form needs: an optional
// contact phone, and the CAPTCHA token. No tenantId field — the tenant is
// always resolved server-side from the :tenantSlug URL param (see
// public-registration.routes.ts), so there is nothing here for a crafted
// payload to override.
export const submitRegistrationSchema = memberFieldsSchema.extend({
  phone: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().min(8, "Nomor telepon tidak valid").max(20, "Nomor telepon tidak valid").optional()
  ),
  captchaToken: z.string().min(1, "Captcha wajib diisi")
});

export type SubmitRegistrationInput = z.infer<typeof submitRegistrationSchema>;
