import { z } from "zod";
import { CooperativeType } from "@siskop/types";

// ── Units ────────────────────────────────────────────────────────────────────

export const createUnitSchema = z.object({
  type: z.nativeEnum(CooperativeType),
  name: z.string().min(1, "Nama unit wajib diisi")
});

export const updateUnitSchema = z.object({
  type: z.nativeEnum(CooperativeType).optional(),
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional()
});

// ── Roles ────────────────────────────────────────────────────────────────────

const modulePermissionsSchema = z.object({
  create: z.boolean().optional(),
  read: z.boolean().optional(),
  update: z.boolean().optional(),
  delete: z.boolean().optional(),
  export: z.boolean().optional()
});

const permissionsSchema = z.object({
  dashboard: modulePermissionsSchema,
  members: modulePermissionsSchema,
  savings: modulePermissionsSchema,
  loans: modulePermissionsSchema,
  reports: modulePermissionsSchema,
  config: modulePermissionsSchema,
  users: modulePermissionsSchema,
  roles: modulePermissionsSchema,
  accounting: modulePermissionsSchema.optional()
});

export const createRoleSchema = z.object({
  name: z.string().min(2, "Nama role minimal 2 karakter"),
  permissions: permissionsSchema
});

export const updateRoleSchema = z.object({
  name: z.string().min(2).optional(),
  permissions: permissionsSchema.optional()
});

// ── Accounts (Chart of Accounts) ───────────────────────────────────────────────

export const createAccountSchema = z.object({
  code: z.string().min(1, "Kode akun wajib diisi"),
  name: z.string().min(2, "Nama akun minimal 2 karakter"),
  category: z.enum(["ASET", "KEWAJIBAN", "EKUITAS", "PENDAPATAN", "BEBAN"]),
  normalBalance: z.enum(["DEBIT", "KREDIT"]),
  parentId: z.string().cuid("Parent ID tidak valid").optional(),
  isHeader: z.boolean().default(false),
  isCashEquivalent: z.boolean().default(false)
});

export const updateAccountSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(2).optional(),
  category: z.enum(["ASET", "KEWAJIBAN", "EKUITAS", "PENDAPATAN", "BEBAN"]).optional(),
  normalBalance: z.enum(["DEBIT", "KREDIT"]).optional(),
  parentId: z.string().cuid().nullable().optional(),
  isHeader: z.boolean().optional(),
  isCashEquivalent: z.boolean().optional(),
  isActive: z.boolean().optional()
});

// ── Account Mappings ─────────────────────────────────────────────────────────

export const upsertAccountMappingSchema = z.object({
  sourceType: z.enum(["SAVING_CONFIG", "LOAN_CONFIG", "SYSTEM"]),
  sourceId: z.string().cuid("Source ID tidak valid").optional(),
  transactionKind: z.enum([
    "DEPOSIT",
    "WITHDRAWAL",
    "DISBURSEMENT",
    "PAYMENT_PRINCIPAL",
    "PAYMENT_INTEREST",
    "PAYMENT_PENALTY"
  ]),
  debitAccountId: z.string().cuid("Akun debit tidak valid"),
  creditAccountId: z.string().cuid("Akun kredit tidak valid")
});

// ── SHU Distribution ─────────────────────────────────────────────────────────

export const upsertShuDistributionConfigSchema = z
  .object({
    jasaSimpananPercent: z.coerce.number().min(0).max(100),
    jasaPinjamanPercent: z.coerce.number().min(0).max(100),
    cadanganPercent: z.coerce.number().min(0).max(100),
    lainnyaPercent: z.coerce.number().min(0).max(100)
  })
  .refine(
    (d) => Math.abs(d.jasaSimpananPercent + d.jasaPinjamanPercent + d.cadanganPercent + d.lainnyaPercent - 100) < 0.01,
    { message: "Total persentase alokasi SHU harus 100%" }
  );

// ── Whitelabel ───────────────────────────────────────────────────────────────

export const upsertWhitelabelConfigSchema = z.object({
  customDomain: z.string().min(1).nullable().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Warna harus format hex, contoh #1D4ED8")
    .nullable()
    .optional(),
  hideBranding: z.boolean().optional(),
  emailSenderName: z.string().min(1).nullable().optional(),
  emailSenderAddress: z.string().email("Email tidak valid").nullable().optional()
});

// ── Modal Disetor ────────────────────────────────────────────────────────────

export const updateModalDisetorSchema = z.object({
  modalDisetor: z.coerce.number().nonnegative("Modal disetor tidak boleh negatif").nullable()
});

export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type UpdateAccountInput = z.infer<typeof updateAccountSchema>;
export type UpsertAccountMappingInput = z.infer<typeof upsertAccountMappingSchema>;
export type UpsertShuDistributionConfigInput = z.infer<typeof upsertShuDistributionConfigSchema>;
export type UpsertWhitelabelConfigInput = z.infer<typeof upsertWhitelabelConfigSchema>;
export type UpdateModalDisetorInput = z.infer<typeof updateModalDisetorSchema>;
