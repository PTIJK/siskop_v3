import { z } from "zod";

// Mirrors the backend's memberFieldsSchema (modules/members/schema.ts) field-
// for-field, including message wording — the same rules the server enforces,
// surfaced client-side for immediate feedback. captchaToken is deliberately
// not part of this schema: it comes from the Turnstile widget's callback, not
// a form field, and its presence is checked separately before submit.
export const publicRegistrationSchema = z.object({
  fullName: z.string().min(2, "Nama minimal 2 karakter"),
  nik: z.string().length(16, "NIK harus 16 digit").regex(/^\d+$/, "NIK harus berupa angka"),
  address: z.string().min(10, "Alamat harus lengkap"),
  birthPlace: z.string().min(2, "Tempat lahir wajib diisi"),
  birthDate: z.string().min(1, "Tanggal lahir wajib diisi"),
  occupation: z.string().min(2, "Pekerjaan wajib diisi"),
  phone: z
    .string()
    .optional()
    .refine((v) => !v || (v.length >= 8 && v.length <= 20), { message: "Nomor telepon tidak valid" })
});

export type PublicRegistrationForm = z.infer<typeof publicRegistrationSchema>;
